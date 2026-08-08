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
const NO_FRONTMATTER_ERROR_MSG = ": deck contains no frontmatter or "
                               + "unterminated frontmatter (skipping)";
const ALL_DRAFTS_ERROR_MSG     = ": all slides in deck are drafts (skipping)";
const NOT_PLAIN_TEXT_ERROR_MSG = ": not a plaintext file (skipping)";

const NUM_DECKS_MSG = " decks to convert\n";
const SUCCESS_MSG   = " decks converted";
const FAILURE_MSG   = " decks could not be converted\n";

/**
 * Checks if the provided file path points to a valid UTF-8 encoded file.
 * 
 * @param {string} path - The path of the file to check.
 * 
 * @returns {boolean} True if the file is valid UTF-8, or false otherwise.
 */
function isUTF8(path) {
    // `fatal` makes the decoder throw an error if it tries to read a non-UTF-8
    // character, instead of substituting it.
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


/**
 * Converts an array of blocks into a deck model.
 * The deck model contains all keys and values from the deck's frontmatter,
 * and an array of slides.
 * Separators split the block array into slides.
 * Slides with "draft" set to true are not parsed.
 * This function assumes that the blocks belong to a valid deck.
 *
 * @param {Object[]} blocks - Array of JSON blocks parsed from a PresentMD
 *                            document.
 * 
 * @return {Object} A deck model containing keys and values from the
 *                  frontmatter, and an array of slide models.
 */
function toModel(blocks) {
    const model = {};
    const frontmatter = blocks.filter((b) => b.kind == "frontmatter")[0];
    Object.assign(model, frontmatter.settings);

    return model;
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
 * @param {string} path           - The relative path of the file to process.
 * @param {string} outputDir      - The relative path of the directory to store
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

    if (parsedDeck.blocks[0].kind != "frontmatter") {
        console.error(path + NO_FRONTMATTER_ERROR_MSG);
        return 0;
    }

    // TODO: Error when all slides are drafts.
    //       Implement once JSON is parsed to slides.

    const model = toModel(parsedDeck.blocks);

    //console.log(parsedDeck.blocks + "\n");

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
        })
        .reduce((acc, file) => {
            acc += processFile(file, outputDir, outputModel);
            return acc;
        }, 0);

        console.log(`\n${successes}` + SUCCESS_MSG);
        console.log(`${files.length - successes}` + FAILURE_MSG);

    }
}

main();