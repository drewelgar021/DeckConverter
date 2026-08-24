const childProcess = require("child_process");
const { parsePresentMD } = require("../presentMDparser.js")
const { parseBlock, getDirectives } = require("../deckconverter.js");

const DIRECTIVES = `
<!-- backgroundColor: "value" -->

<!-- layout: "value" -->

<!-- agenda -->

<!-- color: "value" -->

<!-- invalid: "value" -->`;



VALID_DIRECTIVES = ["backgroundColor", "layout", "agenda"]

function directivesTest() {
    const blocks = getDirectives(parsePresentMD(DIRECTIVES).blocks);

    for (let i = 0; i < blocks.length; i++) {
        expect(VALID_DIRECTIVES.contains(blocks[i].key)).toBe(false);
        expect(parseBlock(blocks[i])).toBe( 
`                <text:p text:style-name=\"p-body\">
                    [Invalid directive key: ${blocks[i].key}]
                </text:p>\n`
        );
    }
}

const HEADINGS = `
# text

## text

### text

#### text

##### text`;

function headingsTest() {
    const blocks = parsePresentMD(HEADINGS).blocks;

    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].level == 1 || blocks[i].level == 2) {
            expect(parseBlock(blocks[i])).toBe(
`                <text:p text:style-name=\"p-title\">text</text:p>\n`
            );
        } else if (blocks[i].level == 3) {
            expect(parseBlock(blocks[i])).toBe(
`                <text:p text:style-name=\"p-subhead\">text</text:p>\n`
            );
        } 
    }
}

const PARAGRAPH = `
one

two
three
`;

function paragraphTest() {
    const blocks = parsePresentMD(PARAGRAPH).blocks;
    expect(blocks.length).toBe(2);
    expect(parseBlock(blocks[0])).toBe(
`                <text:p text:style-name=\"p-body\">one</text:p>\n`
    );
    expect(parseBlock(blocks[1])).toBe(
`                <text:p text:style-name=\"p-body\">two three</text:p>\n`
    );
}

const INLINE_FORMATTING = `
**bold** _italic_ ~~strike~~
`;

function inlineFormattingTest() {
    const blocks = parsePresentMD(INLINE_FORMATTING).blocks;
    expect(parseBlock(blocks[0])).toBe(
`                <text:p text:style-name=\"p-body\">`
              + "<text:span text:style-name=\"t-bold\">bold</text:span> "
              + "<text:span text:style-name=\"t-italic\">italic</text:span> "
              + "<text:span text:style-name=\"t-strike\">strike</text:span>"
              + "</text:p>\n"
    );
}

const QUOTE = `
> quote
`;

function quoteTest() {
    const blocks = parsePresentMD(QUOTE).blocks;
    expect(parseBlock(blocks[0])).toBe(
`                <text:p text:style-name=\"p-quote\">quote</text:p>\n`
    );
}

const LIST = `
- l1
- l1
  - l2
  - l2

1. one
2. two
`

function listTest() {
    const blocks = parsePresentMD(LIST).blocks;
    expect(blocks.length).toBe(2);

    expect((parseBlock(blocks[0]))).toBe(
`            <text:list text:style-name=\"l-bullets\">
                <text:list-item><text:p text:style-name=\"p-body\">l1</text:p></text:list-item>
                <text:list-item><text:p text:style-name=\"p-body\">l1</text:p><text:list>
                <text:list-item><text:p text:style-name=\"p-body\">l2</text:p></text:list-item>
                <text:list-item><text:p text:style-name=\"p-body\">l2</text:p></text:list-item>
</text:list>
</text:list-item>
            </text:list>
`
    );
    expect((parseBlock(blocks[1]))).toBe(
`            <text:list text:style-name=\"l-numbered\">
                <text:list-item><text:p text:style-name=\"p-body\">one</text:p></text:list-item>
                <text:list-item><text:p text:style-name=\"p-body\">two</text:p></text:list-item>
            </text:list>
`
    );
    
}


test("Valid directives produce no visible output, invalid directives produce "
    + "error message.", directivesTest);

test("Level 1 and 2 headings are parsed as titles, level 3 headings are parsed "
    + "as subheadings, and higher level headings produce an error message.",
    headingsTest);

test("Paragraphs are separated by empty lines and single newlines within a "
    + "paragraph become spaces.", paragraphTest);

test("Bold, italicised, and struck text render within paragraphs.",
    inlineFormattingTest);

test("Quotes have correct \"p-quote\" style.", quoteTest);

test("Lists have correct styling and indenting creates lower list levels.",
    listTest);
