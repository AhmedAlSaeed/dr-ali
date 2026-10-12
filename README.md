# Fellow Case Conference

**Live: <https://alihy8.github.io/casebook/>**

## Run it

```bash
npm ci               # in a fresh clone
npm run dev          # http://localhost:5173
npm run build        # -> dist/ (static; serve over HTTP, hash routing)
npm run preview      # serve dist/
npm run typecheck
```

Optional — rebuild the content from the source deck (needs the `.pptx`; the extracted
`public/content.json` + `public/media/` are committed, so a clone runs without it):

```bash
npm run extract      # deck -> public/content.json + public/media + public/brand
                     # overridable:  DECK=~/somewhere/AliFellow.pptx npm run extract
```

The site needs an HTTP server — `file://` won't work.
