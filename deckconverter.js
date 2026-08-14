/**
 * @file deckconverter.js
 * @author Drew Elgar
 */

const childProcess = require("child_process");
const fs = require("fs");

const PARSER_PATH = "./presentMDparser.js";

const USAGE_ERROR_MSG = "Usage: node deckconverter.js <input | input-dir> "
                      + "<output-dir> [--model]";
const PATH_ERROR_MSG  = "Error: input path does not exist";

const EMPTY_DECK_ERROR_MSG     = ": file is empty (skipping)";
const NO_SLIDES_ERROR_MSG      = ": deck contains no slides (skipping)";
const UNTERMINATED_FRONTMATTER_ERROR_MSG = ": deck contains unterminated "
                                         + "frontmatter (skipping)";
const NO_FRONTMATTER_ERROR_MSG = ": deck contains no frontmatter (skipping)"
const ALL_DRAFTS_ERROR_MSG     = ": all slides in deck are drafts (skipping)";
const NOT_PLAIN_TEXT_ERROR_MSG = ": not a plaintext file (skipping)";

const NUM_DECKS_MSG = " decks to convert\n";
const SUCCESS_MSG   = " decks converted";
const FAILURE_MSG   = " decks could not be converted\n";

const XML_INFO = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";

const ROOT_OPEN =
`<office:document
    xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\"
    xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\"
    xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\"
    xmlns:draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\"
    xmlns:presentation=
        \"urn:oasis:names:tc:opendocument:xmlns:presentation:1.0\"
    xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\"
    xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\"
    office:version=\"1.2\"
    office:mimetype=\"application/vnd.oasis.opendocument.presentation\">
`;
const ROOT_CLOSE = "</office:document>\n"

const STYLES = "<office:styles/>\n";
const AUTO_STYLES_OPEN =
`<office:automatic-styles>
    <style:page-layout style:name=\"PM1\">
    <style:page-layout-properties
        fo:page-width=\"25.4cm\"
        fo:page-height=\"14.29cm\"
        style:print-orientation=\"landscape\"/>
    </style:page-layout>
    <style:style style:name=\"pr-frame\" style:family=\"graphic\">
        <style:graphic-properties draw:fill="none" draw:stroke="none"
            draw:auto-grow-height="true" fo:padding="0cm"/>
    </style:style>
`;
const AUTO_STYLES_CLOSE = "</office:automatic-styles>\n"
const MASTER_STYLES =
`<office:master-styles>
    <style:master-page style:name=\"Default\" style:page-layout-name=\"PM1\"/>
</office:master-styles>
`;

const BODY_OPEN = "<office:body><office:presentation>\n";
const BODY_CLOSE = "</office:presentation></office:body>\n";
const SLIDE_CLOSE = "   </draw:page>\n"

const META_OPEN = 
`<office:meta>
    <meta:generator>deckconverter</meta:generator>
`;
const META_CLOSE = "</office:meta>\n";

/**
 * Checks if the provided file path points to a valid UTF-8 encoded file.
 * 
 * @param {String} path - The path of the file to check.
 * 
 * @returns {boolean} True if the file is valid UTF-8, or false otherwise.
 */
function isUTF8(path) {
    // `fatal` makes the decoder throw an error if it tries to read a non-UTF-8
    // character, instead of substituting it.
    // There is probably a cleaner way of doing this, but this way is easy.
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
        decoder.decode(fs.readFileSync(path));
        return true;
    } catch {
        return false;
    }
}


/**
 * Tests each element of an array using a provided predicate, and returns
 * a new array containing all elements from the original before the first
 * element that made the predicate evaluate to false.
 * 
 * @param {(T) => boolean} predicate - When this evaluates to false, an
 *                                     array containing all previously
 *                                     accumulated elements from the
 *                                     original array will be returned.
 * @param {T[]} array                - The array to take elements from.
 *
 * @returns {T[]} Array containing elements accumulated from the original
 *                array while the provided predicate returns true.
 */
function takeWhile(predicate, array) {
    if (array == undefined || array.length == 0) {
        return [];
    }

    if (!predicate(array[0])) {
        return [];
    }

        return [array[0]].concat(takeWhile(predicate, array.slice(1)));
}


const toKebabCase = (str) => str.toLowerCase().replaceAll(' ', '-');


/**
 * Extracts the key-value pairs from directives, in an array of blocks, and
 * returns an object containing them.
 * This function does not group directives by slides, so the blocks provided
 * presumably belong to the same slide.
 *
 * @param {Object[]} blocks - The array of blocks to extract directive key-value
 *                            pairs from.
 *
 * @return {Object} An object containing all the extracted key-value pairs.
 *
 */
function getDirectives(blocks) {
    const directives = {};

    blocks.filter((block) => block.kind == "directive")
          .forEach((block) => {
              directives[block.key] = block.value;
          });
    return directives;
}


/**
 * Extracts blocks from a provided array that relate to slide content.
 *
 * @param {Object[]} blocks - The array to extract slide content blocks from.
 *
 * @return {Object[]} An array containing only slide content-related blocks
 *                    derived from the provided array of blocks.
 */
function getContent(blocks) {
    return blocks.filter((block) => block.kind != "directive");
}


/**
 * Converts an array of blocks into an array of slides.
 * Blocks separated by blocks of kind "separator" are grouped into slides.
 * Each slide contains properties called settings, which are specified in
 * directives, and a content property.
 * Draft slides are excluded from the return.
 *
 * @param {Object[]} blocks - Array of JSON blocks parsed from a PresentMD
 *                            document.
 * @param {Object[]} [acc]   - Array of already accumulated slides to append to.
 *
 * @return {Object []} An array of slides converted from the provided array of
 *                     blocks, appended to `acc`.
 */
function getSlides(blocks, acc = []) {
    if (blocks.length == 0) {
        return [];
    }

    const slideBlocks = takeWhile((block) => block.kind != "separator", blocks);
    const slide = {...getDirectives(slideBlocks)};

    // Do not append draft slides to accumulator.
    if (slide.draft == "true") {
        return getSlides(blocks.slice(slideBlocks.length + 1),
            acc.concat(slide));
    }

    slide.content = getContent(slideBlocks);

    return [slide].concat(getSlides(blocks.slice(slideBlocks.length + 1),
        acc.concat(slide)));
}

/**
 * Converts an array of blocks into a deck model.
 * The deck model contains all keys and values from the deck's frontmatter,
 * and an array of slides.
 * Separators split the block array into slides.
 * Slides with "draft" set to true are not parsed.
 * This function assumes that the blocks belong to a valid deck, implying the
 * assumption that the first block is the frontmatter.
 *
 * @param {Object[]} blocks - Array of JSON blocks parsed from a PresentMD
 *                            document.
 * 
 * @return {Object} A deck model containing keys and values from the
 *                  frontmatter, and an array of slide models.
 */
function toModel(blocks) {
    const frontmatter = blocks[0]; // We assume that this is the frontmatter.
    const model = {...frontmatter.settings};
    model.slides = getSlides(blocks.slice(1));

    return model;
}

/**
 * Obtains the ODF document-wide style information from a JSON deck model, and
 * returns an XML ODF representation that can be used directly in a flat ODP
 * file.
 * Also includes the default style information.
 * It is assumed that the model is valid.
 *
 * @param {Object} model - The JSON model being parsed to ODF.
 *
 * @return {String} The ODF `office:automatic-styles`, `office:master-styles`,
 *                  and (empty) `office:styles` trees parsed from the model.
 */
function parseStyles(model) {
    return STYLES + AUTO_STYLES_OPEN + AUTO_STYLES_CLOSE + MASTER_STYLES;
}


const SAMPLE_PAGE =
`<draw:page draw:name="test" draw:master-page-name="Default">
    <draw:frame draw:style-name="pr-frame" svg:x="1.4cm" svg:y="0.9cm"
        svg:width="22.6cm" svg:height="2.5cm">
        <draw:text-box>
            <text:p text:style-name="p-title">Test</text:p>
        </draw:-box>
    </draw:frame>
</draw:page>
`


/**
 * Parses a JSON block to ODF slide content.
 * This function is called recursively on each element of `block.runs`, until an
 * element with a `value` key is found, at which point it will return the text.
 * Each return will be prepended and appended with the appropriate opening and
 * closing XML tags, which are determined by the `block.type`.
 *
 * @param {Object} block - A single block to parse, which may recursively
 *                         contain more blocks in its `runs` array.
 * @param {int} [yOffet] - The y position offset to place the element on the
 *                         slide, to allow stacking with previously parsed
 *                         elements.
 * 
 * @return {String} The parsed ODF slide content.
 */
function parseBlock(block, yOffset = 0.9) {
    if (block.type == "text") {
        // Minimum structure is a block of text.
        return block.value;
    }
    // I wish I could use constants but need to inject yOffset >:(
    // This looks like shit
    if (block.kind == "heading") {
        if (block.level == 1 || block.level == 2) {
            const open = 
`       <draw:frame presentation:class=\"title\" draw:style-name=\"pr-frame\"
                svg:x=\"1.4cm\" svg:y=\"${yOffset}cm\"
                svg:width=\"22.6cm\" svg:height=\"2.5cm\">
            <draw:text-box>
                <text:p text:style-name=\"p-title\">`
            const close = 
`</text:p>
            </draw:text-box>
        </draw:frame>\n`

            return open
                + block.runs.map((run) => parseBlock(run, yOffset)).join("")
                + close;
        }
    }
    return "";
}


/**
 * Parses a JSON slide structure to an ODF page.
 * It is assumed that the slide is valid.
 *
 * @param {Object} slide - The JSON slide being parsed to ODF.
 * @param {int} slideNo  - Used in the fallback slide name where no title is
 *                         provided.
 * 
 * @return {String} The single ODF slide parsed from the provided slide
 *                  structure.
 */
function parseSlide(slide, slideNo) {
    // Take the first heading of level 1 or 2 as the title.34
    const title = slide.content
        .filter((block) => block.kind == "heading"
            && (block.level == 1 || block.level == 2))[0]
        .runs.filter((run) => run.type == "text")[0].value;
    const parsedBlocks = slide.content.map((block) => parseBlock(block));

    const slideName = title ? toKebabCase(title) : `$slide${slideNo}`;

    const open =
`   <draw:page draw:name=\"${slideName}\" draw:master-page-name=\"Default\">\n`;

    return open + parsedBlocks.join("") + SLIDE_CLOSE;
}

/**
 * Obtains the document body for an ODF presentation from a JSON deck model.
 * It is assumed that the model is valid.
 *
 * @param {String} model - The JSON model being parsed to ODF.
 *
 * @return {String} The ODF `office:body` tree parsed from the model.
 */
function parseBody(model) {
    const parsedSlides = model.slides
        .map((slide, index) => parseSlide(slide, index));
    return BODY_OPEN + parsedSlides.join("") + BODY_CLOSE;
}


/**
 * Obtains the meta information from a JSON deck model and returns an ODP meta
 * tree containing this information.
 *
 * @param {Object} model - The JSON model being parsed to ODF.
 *
 * @return {String} The ODF `office:meta` tree parsed from the model.
 */
function parseMeta(model) {
    const undefinedToBlank = (str) => {
        if (str == undefined) return "";
        return str;
    }

    const title = undefinedToBlank(model.title);
    const author = undefinedToBlank(model.author);

    return META_OPEN + `<dc:title>${title}</dc:title>`
         + `<dc:creator>${author}</dc:creator>\n` + META_CLOSE;
}


/**
 * Converts a JSON deck model into an ODF tree.
 * It is assumed that the deck model is valid.
 *
 * @param {Object} model - The JSON model to convert to ODF.
 *
 * @return {String} An ODF tree representation of the JSON model.
 */
function toODF(model) {
    const styles = parseStyles(model);
    const body = parseBody(model);
    const meta = parseMeta(model);
    return XML_INFO + ROOT_OPEN + styles + body + meta + ROOT_CLOSE;
}


/**
 * Carries out the entire conversion from PresentMD to Flat ODP, including
 * the intermediate JSON model conversion, for a single file.
 * If a deck fails to convert, then a message will be printed to stderr.
 * If a deck successfully converts, then a Flat ODP file will be output to
 * the output directory defined in `main()`.
 * If the `--model` flag is set in `main()`, then the intermediate JSON
 * model will also be written to a file in the same output directory.
 * 
 * @param {String} path           - The relative path of the file to process.
 * @param {String} outputDir      - The relative path of the directory to store
 *                                  converted decks in.
 * @param {boolean} [outputModel] - Whether to also write the model to a file.
 * 
 * @returns {int} 1 if the conversion is successful, or 0 otherwise.
 */
function processFile(path, outputDir, outputModel = false) {
    if (!isUTF8(path)) {
        console.error(path + NOT_PLAIN_TEXT_ERROR_MSG);
        return 0;
    }
    const parsedDeck = JSON.parse(
        childProcess.execFileSync(process.execPath, [PARSER_PATH, path])
    );

    if (parsedDeck.blocks.length == 0) {
        console.error(path + EMPTY_DECK_ERROR_MSG);
        return 0;
    }

    if (parsedDeck.blocks.length == 1
        && parsedDeck.blocks[0].kind == "frontmatter") {
        console.error(path + NO_SLIDES_ERROR_MSG);
        return 0;
    }

    if (parsedDeck.blocks[0].kind == "separator") {
        console.error(path + UNTERMINATED_FRONTMATTER_ERROR_MSG);
        return 0;

    } else if (parsedDeck.blocks[0].kind != "frontmatter") {
        console.error(path + NO_FRONTMATTER_ERROR_MSG);
        return 0;
    }

    const model = toModel(parsedDeck.blocks);

    if (model.slides.length == 0) {
        console.error(path + ALL_DRAFTS_ERROR_MSG);
        return 0;
    }

    // Right side of last "/" -> left side of first "."
    const dirTokens = path.split("/");
    const fileName = dirTokens[dirTokens.length - 1].split(".")[0];

    const odf = toODF(model);
    fs.writeFileSync(`${outputDir}/${fileName}.fodp`, odf);

    if (outputModel) {
        fs.writeFileSync(`${outputDir}/${fileName}.model.json`,
            `${JSON.stringify(model, null, 2)}\n`);
    }

    return 1;
}


function main() {
    if (process.argv.length != 4 && process.argv.length != 5) {
        console.error(USAGE_ERROR_MSG);
        return;
    }

    if (process.argv.length == 5 && process.argv[4] != "--model") {
        console.error(USAGE_ERROR_MSG);
        return;
    }

    const inputPath = process.argv[2];
    const outputDir = process.argv[3];
    const outputModel = process.argv.length == 5;

    // statSync() throws an error if file does not exist.
    try {
        const stats = fs.statSync(inputPath);
    } catch {
        // Catch error if path does not exist to provide user-friendly error
        // warning instead of verbose one.
        console.error(PATH_ERROR_MSG);
        return;
    }

    try {
        const stats = fs.statSync(outputDir);
    } catch {
        // Make output directory if it does not exist.
        fs.mkdirSync(outputDir);
    }

    const stats = fs.statSync(inputPath);

    if (stats.isFile()) {
        console.log(`${1}` + NUM_DECKS_MSG)
        const successes = processFile(inputPath, outputDir, outputModel);

        console.log(`\n${successes}` + SUCCESS_MSG);
        console.log(`${1 - successes}` + FAILURE_MSG);


    } else if (stats.isDirectory()) {
        const files = fs.readdirSync(inputPath);
        console.log(`${files.length}` + NUM_DECKS_MSG);

        const successes = files.map((file) => {
            // Append `/` to directory path if not explicitly included.
            if (inputPath[inputPath.length - 1] == '/') {
                return `${inputPath}${file}`;
            }
            return `${inputPath}/${file}`;

        }).reduce((acc, file) => {
            acc += processFile(file, outputDir, outputModel);
            return acc;
        }, 0);

        console.log(`\n${successes}` + SUCCESS_MSG);
        console.log(`${files.length - successes}` + FAILURE_MSG);

    }
}

main();
