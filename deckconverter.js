const USAGE_ERROR_MSG = "Usage: node deckconverter.js <input | input_dir> "
                      + "<output_dir> [--model]\n";


function main() {
    if (process.argv.length != 4 && process.argv.length != 5) {
        console.error(USAGE_ERROR_MSG);
        return;
    }
}


main()
