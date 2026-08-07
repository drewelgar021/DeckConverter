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

const NOT_PLAIN_TEXT_ERROR_MSG = ": not a plaintext file (skipping)\n";

const NUM_DECKS_MSG = " decks to convert\n";
const SUCCESS_MSG   = " decks converted";
const FAILURE_MSG   = " decks could not be converted\n";


function main() {

    // ARG PARSING AND VALIDATION
    // This is executed before function declarations so that functions can use
    // parsed arg values.

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


    /**
     * Checks if the provided file path points to a valid utf-8 encoded file.
     * @param {string} path - The path of the file to check.
     * @returns {boolean} True if the file is valid utf-8, or false otherwise.
     */
    function isUTF8(path) {
        // Checks for binary garbage by ensuring that all characters are valid
        // utf-8 (as hinted in assignment spec).
        const decoder = new TextDecoder("utf-8", { fatal: true });
        try {
            decoder.decode(fs.readFileSync(path));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Carries out the entire conversion from PresentMD to Flat ODP, including
     * the intermediate JSON model conversion, for a single file.
     * @param {string} path - The path of the file to process.
     * @returns {int} 1 if the conversion is successful, or 0 otherwise.
     */
    function processFile(path) {
        if (!isUTF8(path)) {
            console.error(path + NOT_PLAIN_TEXT_ERROR_MSG);
            return 0;
        }
        const parsedDeck = JSON.parse(
            childProcess.execFileSync(process.execPath, [PARSER_PATH, path])
        );

        // console.log(parsedDeck.blocks[0]);
        
        return 1;
    }


    // statSync() throws an error if file does not exist.
    try {
        const stats = fs.statSync(inputPath);
    } catch {
        // Catch error if path does not exist to provide user-friendly error
        // warning instead of verbose one.
        console.error(PATH_ERROR_MSG);
        return;
    }

    const stats = fs.statSync(inputPath);

    if (stats.isFile()) {
        console.log(`${1}` + NUM_DECKS_MSG)
        if (processFile(inputPath) == 1) {
            console.log(`${1}` + SUCCESS_MSG);
            console.log(`${0}` + FAILURE_MSG);
        } else {
            console.log(`${0}` + SUCCESS_MSG);
            console.log(`${1}` + FAILURE_MSG);
        }

    } else if (stats.isDirectory()) {
        const files = fs.readdirSync(inputPath);
        console.log(`${files.length}` + NUM_DECKS_MSG);
        const successes = files.map((file) => `${inputPath}/${file}`)
            .reduce((acc, file) => {
                acc += processFile(file);
                return acc;
            }, 0);

        console.log(`${successes}` + SUCCESS_MSG);
        console.log(`${files.length - successes}` + FAILURE_MSG);

    }
}

main()
