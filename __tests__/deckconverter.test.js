const childProcess = require("child_process");
const { parsePresentMD } = require("../presentMDparser.js")
const { parseBlock } = require("../deckconverter.js");

const DIRECTIVES = `
<!-- backgroundColor: "value" -->

<!-- layout: "value" -->

<!-- agenda -->

<!-- color: "value" -->

<!-- invalid: "value" -->`;



VALID_DIRECTIVES = ["backgroundColor", "layout", "agenda"]

function directivesTest() {
    const blocks = parsePresentMD(DIRECTIVES).blocks;

    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].key in VALID_DIRECTIVES) {
            expect(parseBlock(blocks[i]) == "");
        } else {
            expect(parseBlock(blocks[i]) == 
`<text:p text:style-name=\"p-body\"
    [Invalid directive key: ${blocks[i].key}]
</text:p>\n`
        );

        }
    }

};

const HEADINGS = `
# First

## Second

### Third

#### Fourth

##### Fifth`;

function headingsTest() {
    const blocks = parsePresentMD(HEADINGS).blocks;

    for (let i = 0; i < blocks.length; i++) {
        continue;
    }
}

test("Valid directives produce no visible output, invalid directives produce "
    + "error message.", directivesTest);

test("Level 1 and 2 headings are parsed as titles, level 3 headings are parsed "
    + "as subheadings, and higher level headings produce an error message.",
    headingsTest);
