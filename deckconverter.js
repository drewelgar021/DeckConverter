const USAGE_ERROR_MSG = "Usage: node deckconverter.js <input | input-dir> "
                      + "<output-dir> [--model]\n";


function main() {
    // Check args for validity.
    if (process.argv.length != 4 && process.argv.length != 5) {
        console.error(USAGE_ERROR_MSG);
        return;
    }
    if (process.argv.length == 5 && process.argv[4] != "--model") {
        console.error(USAGE_ERROR_MSG);
        return;
    }
}


main()
