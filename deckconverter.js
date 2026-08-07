const childProcess = require("child_process");
const fs = require("fs");

const USAGE_ERROR_MSG = "Usage: node deckconverter.js <input | input-dir> "
                      + "<output-dir> [--model]";
const PATH_ERROR_MSG  = "Error: input path does not exist";

const SINGLE_DECK_MSG = "1 deck to convert";
const NUM_DECKS_MSG   = " decks to convert";


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
     * Carries out the entire conversion from PresentMD to Flat ODP, including
     * the intermediate JSON model conversion, for a single file.
     * @param {string} path - The path of the file to process.
     */
    function processFile(path) {
        const parsedDeck = JSON.parse(
            childProcess.execSync(`node presentMDparser.js ${path}`).toString()
        );
    }


    // statSync() throws an error if file does not exist.
    try {
        const stats = fs.statSync(inputPath);
    } catch (error) {
        // Catch error if path does not exist to provide user-friendly error
        // warning instead of verbose one.
        console.error(PATH_ERROR_MSG);
        return;
    }

    const stats = fs.statSync(inputPath);

    if (stats.isFile()) {
        console.log(SINGLE_DECK_MSG)
        processFile(inputPath);

    } else if (stats.isDirectory()) {
        const files = fs.readdirSync(inputPath);
        console.log(`${files.length}` + NUM_DECKS_MSG);
        files.forEach(processFile);
    }
}

main()
