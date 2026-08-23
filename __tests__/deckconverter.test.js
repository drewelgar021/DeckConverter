const childProcess = require("child_process");
const { parseBlock, PARSER_PATH } = require("../deckconverter.js");

/**
 * Helper function that calls the PresentMD parser on a markdown file.
 * This returns a list of blocks, not ODF.
 *
 * @param {String} path - The path to the markdown file to parse to blocks.
 *
 * @return {Object} A list of blocks parsed from the markdown.
 */
const parsePresentMD = (path) =>
    JSON.parse(
        childProcess.execFileSync(process.execPath, [PARSER_PATH, path])
    );


console.log(parsePresentMD("# Heading"))
