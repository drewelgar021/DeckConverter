# DeckConverter

This application converts a markdown document using the PresentMD specification to an ODF
presentation (flat ODP) file.

Requires node.js.

## Usage
### Deck Conversion
To convert a deck, or entire directory of decks to ODF:

```
node deckconverter.js <input | input-dir> <output-dir> [--model]
```

The ODF files will be output to `outputdir` as `filename.fodp`.
The optional `--model` arg will also output a JSON model representation of the deck to the same
directory, `filename.model.json`.
