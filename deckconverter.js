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

const STYLES_OPEN =
`<office:styles/>
<office:automatic-styles>

    <style:page-layout style:name=\"PM1\">
        <style:page-layout-properties
                fo:page-width=\"25.4cm\"
                fo:page-height=\"14.29cm\"
            style:print-orientation=\"landscape\"/>
    </style:page-layout>

    <style:style style:name=\"pr-frame\" style:family=\"graphic\">
        <style:graphic-properties draw:fill=\"none\" draw:stroke=\"none\"
            draw:auto-grow-height=\"true\" fo:padding=\"0cm\"/>
    </style:style>\n`;

const STYLES_CLOSE = "</office:automatic-styles>\n"
const MASTER_STYLES =
`<office:master-styles>
    <style:master-page style:name=\"Default\" style:page-layout-name=\"PM1\"/>
</office:master-styles>\n`;

const BODY_OPEN = "<office:body><office:presentation>\n";
const BODY_CLOSE = "</office:presentation></office:body>\n";
const SLIDE_CLOSE = "   </draw:page>\n"

const NOTES_OPEN =
`       <presentation:notes>
            <draw:frame presentation:class=\"notes\" draw:style-name=\"pr-frame\"
                    svg:x=\"2cm\" svg:y=\"12cm\"
                    svg:width=\"16cm\" svg:height=\"10cm\">
                <draw:text-box>\n`
const NOTES_CLOSE =
`               </draw:text-box>
            </draw:frame>
        </presentation:notes>\n`;

const META_OPEN = 
`<office:meta>
    <meta:generator>deckconverter</meta:generator>\n`;
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


const escape = (text) => text.replaceAll("&", "&amp;")
                             .replaceAll("<", "&lt;")
                             .replaceAll(">", "&gt;")
                             .replaceAll("\"", "&quot;");


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

VALID_DIRECTIVES = ["draft", "agenda", "backgroundColor", "layout"];

/**
 * Extracts blocks from a provided array that relate to slide content.
 * Only directive blocks that have valid keys are removed; invalid directives
 * are kept so that they can be detected for error handling.
 *
 * @param {Object[]} blocks - The array to extract slide content blocks from.
 *
 * @return {Object[]} An array containing only slide content-related blocks (and
 *                    invalid directives) derived from the provided array of
 *                    blocks.
 */
function getContent(blocks) {
    return blocks.filter(
        (block) => {
            if (block.kind == "directive"
                    && VALID_DIRECTIVES.includes(block.key)) {
                return false;
            }
            return true;
        }
    );
}


/**
 * Converts an array of blocks into an array of slides.
 * Blocks separated by blocks of kind "separator" are grouped into slides.
 * Each slide contains properties called settings, which are specified in
 * directives, and a content property.
 * Draft slides are excluded from the return.
 *
 * @param {Object[]} blocks  - Array of JSON blocks parsed from a PresentMD
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
 * Creates a set of custom styles for the slide based on its directives.
 * Styles for font color are only generated if a font color directive is
 * explicitly included in the slide, and the same applies for background color.
 * If neither directive exists for a slide, then the empty string will be
 * returned.
 * A slide-specific style will be named after its corresponding default style,
 * with "-sN" appended for slide N.
 *
 * @param {Object} slide - The slide to check for directives.
 * @param {String} A set of ODF styles that implement the color and
 * backgroundColor directives.
 */
function createCustomStyles(slide, slideNo) {
    const backgroundColorStyle = slide.backgroundColor ?
`    <style:style style:name=\"dp-slide-s${slideNo}\"
            style:family=\"drawing-page\">
        <style:drawing-page-properties draw:fill=\"solid\"
                draw:fill-color=\"${slide.backgroundColor}\"
                presentation:background-visible=\"true\"
                presentation:background-objects-visible=\"true\"/>
    </style:style>\n`
        : "";

    return backgroundColorStyle;
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
    const backgroundColor = model.backgroundColor ? model.backgroundColor
                            : "#ffffff";
    const color = model.color ? model.color : "#000000";
    const styles =
`    <style:style style:name=\"dp-slide\" style:family=\"drawing-page\">
        <style:drawing-page-properties draw:fill=\"solid\"
                draw:fill-color=\"${backgroundColor}\"
                presentation:background-visible=\"true\"
                presentation:background-objects-visible=\"true\"/>
    </style:style>


    <style:style style:name=\"p-title\" style:family=\"paragraph\">
        <style:text-properties fo:font-size=\"40pt\" fo:font-weight=\"bold\"
                fo:color=\"${color}\"/>
    </style:style>

    <style:style style:name=\"p-body\" style:family=\"paragraph\">
        <style:text-properties fo:color=\"${color}\"/>
    </style:style>

    <style:style style:name=\"p-subhead\" style:family=\"paragraph\">
        <style:text-properties fo:font-size=\"22pt\" fo:font-weight=\"bold\"
                fo:color=\"${color}\"/>
    </style:style>

    <style:style style:name=\"p-quote\" style:family=\"paragraph\">
        <style:text-properties fo:font-style=\"italic\"
                fo:color=\"${color}\"/>
        <style:paragraph-properties fo:margin-left=\"0.5cm\"/>
    </style:style>


    <style:style style:name=\"t-bold\" style:family=\"text\">
        <style:text-properties fo:font-weight=\"bold\"/>
    </style:style>

    <style:style style:name=\"t-italic\" style:family=\"text\">
        <style:text-properties fo:font-style=\"italic\"/>
    </style:style>

    <style:style style:name=\"t-strike\" style:family=\"text\">
        <style:text-properties style:text-line-through-style=\"solid\"/>
    </style:style>


    <text:list-style style:name=\"l-bullets\">
        <text:list-level-style-bullet text:level=\"1\" text:bullet-char=\"•\">
            <text:list-level-properties text:space-before=\"0cm\"
                    text:min-label-width=\"0.7cm\"/>
            <style:text-properties fo:color=\"${color}\"/>
        </text:list-level-style-bullet>

        <text:list-level-style-bullet text:level=\"2\" text:bullet-char=\"-\">
            <style:list-level-properties text:space-before=\"0.9cm\"
                    text:min-label-width=\"0.7cm\"/>
            <style:text-properties fo:color=\"${color}\"/>
        </text:list-level-style-bullet>
    </text:list-style>

    <text:list-style style:name=\"l-numbered\">
        <text:list-level-style-number text:level=\"1\" style:num-format=\"1\"
                style:num-suffix=\".\">
            <style:list-level-properties text:space-before=\"0cm\"
                    text:min-label-width=\"0.7cm\"/>
            <style:text-properties fo:color=\"${color}\"/>
        </text:list-level-style-number>
    </text:list-style>\n`;

    // Per-slide styles
    const customStyles = model.slides
        .map((slide, index) => createCustomStyles(slide, index)).join("");

    return STYLES_OPEN + styles + customStyles + STYLES_CLOSE + MASTER_STYLES;
}


/**
 * Parses a JSON block to ODF slide content.
 * This function is called recursively on each element of `block.runs`, until an
 * element with a `value` key is found, at which point it will return the text.
 * Each return will be prepended and appended with the appropriate opening and
 * closing XML tags, which are determined by the `block.type`.
 *
 * @param {Object} block         - A single block to parse, which may
 *                                 recursively contain more blocks in its `runs`
 *                                 array.
 * @param {String} [customStyle] - A custom style suffix of form "-sN" where N
 *                                 is the slide number, to use custom font and
 *                                 background colours.
 *
 * @return {String} The parsed ODF slide content.
 */
function parseBlock(block) {
    if (block.kind == "directive") {
        // Substitute with error.
        return `<text:p text:style-name=\"p-body\">
    [Invalid directive key: ${block.key}]\n</text:p>\n`
    }
    if (block.type == "text") {
        // Substitute footnotes
        if (block.value.match(/\[\^[0-9]*\]/)) {
            return "[Unsupported: footnote omitted]";
        }
        
        // Minimum structure is a block of text.
        return escape(block.value);
    }
    if (block.kind == "heading") {
        if (block.level == 1 || block.level == 2) {
            const open = 
`                <text:p text:style-name=\"p-title\">`
            const close = "</text:p>\n"
            return open
                + block.runs.map(parseBlock).join("")
                + close;
        }
        if (block.level == 3) {
            const open =
`                <text:p text:style-name=\"p-subhead\">`;
            const close = "</text:p>\n";
            return open
                + block.runs.map(parseBlock).join("")
                + close;
        }
        if (block.level < 1 || block.level > 3) {
            return `<text:p text:style-name=\"p-body\">
    [Unsupported: heading level ${block.level} omitted]\n</text:p>\n`
        }
    }
    if (block.kind == "paragraph") {
        const open =
`                <text:p text:style-name=\"p-body\">`;
        const close = "</text:p>\n"

        return open + block.runs.map(parseBlock).join("") + close;
    }
    
    if (block.kind == "quote") {
        const open =
`                <text:p text:style-name=\"p-quote\">`;
        const close = "</text:p>\n";
        return open + block.runs.map(parseBlock).join("") + close;
    }

    if (block.kind == "list") {
        const style = block.ordered ?
            `l-numbered` : `l-bullets`;
        const open = `            <text:list text:style-name=\"l-bullets\">\n`;
        const close = "        </text:list>\n";

        const items = block.items.map((item) => {
            const open = "                "
                + "<text:list-item><text:p text:style-name=\"p-body\">";
            const closeText = "</text:p>";
            const closeItem = "</text:list-item>\n"

            const subListOpen = item.items.length > 0 ? "<text:list>\n" : "";
            const subListClose = item.items.length > 0 ? "</text:list>\n" : "";

            const subList = item.items.map((item) =>
                open + item.runs.map(parseBlock)
                    .join("") + closeText + closeItem).join("");

            return open
                + item.runs.map(parseBlock).join("")
                + closeText
                + subListOpen + subList + subListClose
                + closeItem;
        });

        return open + items.join("") + close;
    }
    
    if (block.type == "strong") {
        const open = "<text:span text:style-name=\"t-bold\">";
        const close = "</text:span>";
        return open + block.runs.map(parseBlock).join("") + close;
    }

    if (block.type == "em") {
        const open = "<text:span text:style-name=\"t-italic\">";
        const close = "</text:span>";
        return open + block.runs.map(parseBlock).join("") + close;
    }

    if (block.type == "strike") {
        const open = "<text:span text:style-name=\"t-strike\">";
        const close = "</text:span>";
        return open + block.runs.map(parseBlock).join("") + close;
    }

    return "";
}


/**
 * Obtains the ODF title frame from a JSON slide structure.
 * The title is the first level 1 or 2 heading in the slide.
 *
 * @param {Object} slide - The slide being parsed to ODF.
 * @param {String} [customStyle] - A custom style suffix of form "-sX" where X
 *                                 is the slide number, to use custom font and
 *                                 background colours.
 *
 * @param {String} The ODF title frame from the slide provided.
 */
function parseDefaultTitle(slide, customStyle="") {
    const open = 
`        <draw:frame presentation:class=\"title\" draw:style-name=\"pr-frame\"
                svg:x=\"1.4cm\" svg:y=\"0.9cm\"
                svg:width=\"22.6cm\" svg:height=\"2.5cm\">
            <draw:text-box>\n`

    const close =
`            </draw:text-box>
        </draw:frame>\n`;

    // I am going to assume that there is one title and there will be no
    // problem.
    const titleBlock = slide.content
        .filter((block) => block.kind == "heading"
            && (block.level == "1" || block.level == "2"))[0];

    if (titleBlock) {
        return open + parseBlock(titleBlock) + close;
    }

    return "";
}


/**
 * Obtains the ODF content frame from a JSON slide structure.
 *
 * @param {Object} slide         - The slide being parsed to ODF.
 * @param {String} [customStyle] - A custom style suffix of form "-sX" where X
 *                                 is the slide number, to use custom font and
 *                                 background colours
 *
 * @return {String} The ODF content frame from the slide provided.
 */
function parseDefaultContent(slide, customStyle="") {
    const open = 
`        <draw:frame presentation:class=\"outline\" draw:style-name=\"pr-frame\"
                svg:x=\"1.4cm\" svg:y=\"3.9cm\"
                svg:width=\"22.6cm\" svg:height=\"9.2cm\">
            <draw:text-box>\n`;
    const close = 
`            </draw:text-box>
        </draw:frame>\n`;
    const content = slide.content
        .filter((block) => !(block.kind == "heading"
                && (block.level == 1 || block.level == 2))) 
        .map((block) => parseBlock(block)).join("");

    return open + content + close;
}

/**
 * Parses an array of notes blocks into a notes frame.
 * It is assumed that all blocks in the array are of kind "notes".
 *
 * @param {Object[]} blocks - Array containing all notes blocks of a slide.
 *
 * @param {String} An ODF notes element containing the notes.
 */
function parseNotes(blocks) {
    const parsedNotes = blocks.map((block) => 
`                <text:p text:style-name=\"p-notes\">
                    ${escape(block.text)}
                </text:p>\n`);

    return NOTES_OPEN + parsedNotes + NOTES_CLOSE;
}

/**
 * Parses a JSON slide structure to an ODF slide with the default layout.
 *
 * @param {Object} slide   - The JSON slide to parse to ODF.
 * @param {Stirng} [style] - Custom style suffix of the form "-sN" where N is
 *                           the slide number.
 * @return {String} An ODF slide containing the blocks in the provided slide
 *                  structure, of the default layout.
 */
function parseDefaultSlide(slide, style = "") {
    const titleFrame = parseDefaultTitle(slide, style);
    const contentFrame = parseDefaultContent(slide, style);

    return titleFrame + contentFrame;
}


/**
 * Obtains the ODF subtitle frame from a JSON slide structure, for a title
 * slide.
 *
 * @param {Object} slide         - The slide being parsed to ODF.
 * @param {String} [customStyle] - A custom style suffix of form "-sX" where X
 *                                 is the slide number, to use custom font and
 *                                 background colours
 *
 * @return {String} The ODF subtitle frame from the slide provided.
 */
function parseSubtitle(slide, customStyle="") {
    const open = 
`        <draw:frame presentation:class=\"outline\" draw:style-name=\"pr-frame\"
                svg:x=\"1.4cm\" svg:y=\"9cm\"
                svg:width=\"22.6cm\" svg:height=\"4cm\">
            <draw:text-box>\n`;
    const close = 
`            </draw:text-box>
        </draw:frame>\n`;
    const content = slide.content
        .filter((block) => !(block.kind == "heading"
                && (block.level == 1 || block.level == 2))) 
        .map((block) => parseBlock(block)).join("");

    return open + content + close;
}


/**
 * Obtains the ODF title frame from a JSON slide structure, for a title slide
 * layout.
 * The title is the first level 1 or 2 heading in the slide.
 *
 * @param {Object} slide - The slide being parsed to ODF.
 * @param {String} [customStyle] - A custom style suffix of form "-sX" where X
 *                                 is the slide number, to use custom font and
 *                                 background colours.
 *
 * @param {String} The ODF title frame from the slide provided.
 */
function parseTitleTitle(slide, customStyle="") {
    const open = 
`        <draw:frame presentation:class=\"title\" draw:style-name=\"pr-frame\"
                svg:x=\"1.4cm\" svg:y=\"5.0cm\"
                svg:width=\"22.6cm\" svg:height=\"2.5cm\">
            <draw:text-box>\n`

    const close =
`            </draw:text-box>
        </draw:frame>\n`;

    const titleBlock = slide.content
        .filter((block) => block.kind == "heading"
            && (block.level == "1" || block.level == "2"))[0];

    if (titleBlock) {
        return open + parseBlock(titleBlock) + close;
    }

    return "";
}


/**
 * Parses a JSON slide structure to an ODF slide with the title layout.
 * This layout contains a title and a subtitle.
 *
 * @param {Object} slide   - The JSON slide to parse to ODF.
 * @param {Stirng} [style] - Custom style suffix of the form "-sN" where N is
 *                           the slide number.
 * @return {String} An ODF slide containing the blocks in the provided slide
 *                  structure, of the title layout.
 */
function parseTitleSlide(slide, style="") {

    const titleFrame = parseTitleTitle(slide, style);
    const subtitleFrame = parseSubtitle(slide, style);

    return titleFrame + subtitleFrame;
}


/**
 * Parses a JSON slide structure to an ODF slide with the section layout.
 * This layout contains a title only.
 *
 * @param {Object} slide   - The JSON slide to parse to ODF.
 * @param {Stirng} [style] - Custom style suffix of the form "-sN" where N is
 *                           the slide number.
 * @return {String} An ODF slide containing the blocks in the provided slide
 *                  structure, of the section layout.
 */
function parseSectionSlide(slide, style="") {
    const open = 
`        <draw:frame presentation:class=\"title\" draw:style-name=\"pr-frame\"
                svg:x=\"2.5cm\" svg:y=\"5.4cm\"
                svg:width=\"20.4cm\" svg:height=\"3.5cm\">
            <draw:text-box>\n`

    const close =
`            </draw:text-box>
        </draw:frame>\n`;

    const titleBlock = slide.content
        .filter((block) => block.kind == "heading"
            && (block.level == "1" || block.level == "2"))[0];

    if (titleBlock) {
        return open + parseBlock(titleBlock) + close;
    }

    return "";
}


function getRawTitle(slide) {
    const firstHeading = slide.content
        .filter((block) => block.kind == "heading"
                && (block.level == 1 || block.level == 2))[0];

    const ignoreInlineFormatting = (run) => {
        if (run.type == "text") return run.value;
        return run.runs.map(ignoreInlineFormatting).join("");
    }
    if (firstHeading) {
        return firstHeading.runs.map(ignoreInlineFormatting).join("");
    }
    return null;

}

/**
 * Generates an agenda based on the titles of all (non-draft) slides in the
 * deck model.
 * Blocks contained within this slide are ignored.
 *
 * @param {Object} model   - The model being parsed to ODF, from which each
 *                           slide's title will be listed in the agenda.
 * @param {String} [style] - Custom style suffix of the form "-sN" where N is
 *                           the slide number.
 */
function generateAgenda(model) {

    const titleBlock = {
        kind: "heading",
        level: 1,
        runs: [ { type: "text", value: "Agenda" } ]
    };

    const titleFrame = 
`        <draw:frame presentation:class=\"title\" draw:style-name=\"pr-frame\"
                svg:x=\"1.4cm\" svg:y=\"0.9cm\"
                svg:width=\"22.6cm\" svg:height=\"2.5cm\">
            <draw:text-box>
${parseBlock(titleBlock)}
            </draw:text-box>
        </draw:frame>\n`;

    const slides = model.slides.filter((slide) => !(slide.agenda === null));
    const titles = slides.map(getRawTitle).filter((title) => title !== null);
    const open = 
`        <draw:frame presentation:class=\"outline\" draw:style-name=\"pr-frame\"
                svg:x=\"1.4cm\" svg:y=\"3.9cm\"
                svg:width=\"22.6cm\" svg:height=\"9.2cm\">
            <draw:text-box>
                <text:list text:style-name=\"l-bullets\">`;
    const close = 
`               </text:list>
            </draw:text-box>
        </draw:frame>\n`;

    const titleList = titles.map((title) => 
`                  <text:list-item>
                        <text:p text:style-name=\"p-body\">
                            ${title}
                        </text:p>
                    </text:list-item>\n`
    ).join("");
    
    return titleFrame + open + titleList + close;
}


/**
 * Parses a JSON slide structure to an ODF page.
 * It is assumed that the slide is valid.
 *
 * @param {Object} slide           - The JSON slide being parsed to ODF.
 * @param {int} slideNo            - Used in the unique slide name and
 *                                   slide-specific custom styles.
 * @param {Object} model           - The deck model to use for generating an
 *                                   agenda slide.
 * @param {String} [defaultLayout] - The default layout to use when no layout is
 *                                   explicitly defined in the slide's
 *                                   directives.
 * 
 * @return {String} The single ODF slide parsed from the provided slide
 *                  structure.
 */
function parseSlide(slide, slideNo, model, defaultLayout="default") {

    const slideName = `$s${slideNo}`;

    const notesBlocks = slide.content.filter((block) => block.kind == "note");

    const notes = parseNotes(notesBlocks);

    const slideStyle = slide.backgroundColor ? `-s${slideNo}` : "";

    const open =
`   <draw:page draw:name=\"${slideName}\" draw:master-page-name=\"Default\"
            draw:style-name=\"dp-slide${slideStyle}\">\n`;

    const textStyle = slide.color ? `-s${slideNo}` : "";

    // TODO: Remove explicit "slide.layout == "default" comparisons once there
    //       are more layout options.

    // Define a function that uses the correct parser for the defaultLayout.
    const defaultLayoutParser = 
        defaultLayout == "title" ?
            (slide, style) => parseTitleSlide(slide, style) :
        defaultLayout == "section" ?
            (slide, style) => parseSectionSlide(slide, style) :
        (slide, style) => parseDefaultSlide(slide, style);

    const slideContents =
        slide.agenda === null ? generateAgenda(model) :
        slide.layout == "title" ? parseTitleSlide(slide, textStyle) :
        slide.layout == "section" ? parseSectionSlide(slide, textStyle) :
        slide.layout == "default" ? parseDefaultSlide(slide, textStyle) :
        defaultLayoutParser(slide, textStyle) 

    return open + slideContents + notes + SLIDE_CLOSE;
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
        .map((slide, index) => parseSlide(slide, index, model, model.layout));
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
