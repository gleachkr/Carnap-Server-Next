// Each organization's own site icon, fetched once from its site and inlined
// here. Vendored rather than linked because an `<img src="https://charity.org/
// favicon.ico">` makes every visitor's browser announce itself to that
// organization on each view of the donate page — and a third-party favicon
// service would report the same thing to the service instead. Inlined rather
// than served from `public/`, because that directory is gitignored.
//
// The URL each icon came from, its type, and its size are recorded above it.
// They were fetched by a one-off script, since deleted: two entries do not
// justify standing tooling, and these marks change about never. To refresh one
// or add another by hand:
//
//     curl -sL <site>/favicon.ico -o icon                 # or the site's
//                                                         # <link rel=icon>
//     ffmpeg -i icon -vf "scale='min(32,iw)':-1" icon.png # only if over 32px
//     base64 -w0 icon.png
//
// 32px covers a 2× display: `.charity-icon` draws these at 16 CSS px and never
// enlarges one past its own size, so a site's plain 16px favicon stays crisp.
// An id with no entry here falls back to a monogram, so a missing icon is not
// an error.
//
// These are the organizations' own marks, shown beside their names as
// identification. Nothing here is Carnap's.

export const CHARITY_ICONS: Record<string, string> = {
  // https://www.scholarrescuefund.org/wp-content/uploads/2020/04/favicon.ico
  // image/x-icon, 16×16, 1150 bytes
  "scholar-rescue-fund":
    "data:image/x-icon;base64,AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAw8QAAMPEVADDxIwAw8RYAMPEGADDxHwAw8SEAMPEKADDxAAAw8QEAMPEUADDxHgAw8QsAMPEAADDxAAAAAAAAMPEBADDxkQAw8esAMPGVADDxKgAw8dIAMPHgADDxRQAw8QkAMPF2ADDx0gAw8eMAMPG6ADDxRQAw8QAAMPEAADDxAQAw8aMAMPH/ADDxqAAw8S8AMPHsADDx/AAw8U8AMPF0ADDx/AAw8eQAMPHIADDx9wAw8d0AMPEtADDxAAAw8QEAMPGjADDx/wAw8agAMPEvADDx7AAw8fsAMPFlADDxzwAw8fUAMPFkADDxLQAw8YEAMPGDADDxKwAw8QAAMPEBADDxowAw8f8AMPGoADDxLwAw8ewAMPH6ADDxcQAw8d8AMPH6ADDxygAw8cEAMPHPADDx4QAw8YsAMPEAADDxAQAw8aMAMPH/ADDxqAAw8S8AMPHsADDx+wAw8VwAMPG8ADDx/wAw8ZoAMPFfADDxzAAw8f8AMPFzADDxAAAw8QEAMPGjADDx/wAw8agAMPEvADDx7AAw8fwAMPFNADDxSgAw8ecAMPH8ADDx9AAw8f4AMPG7ADDxGwAw8QAAMPEBADDxbwAw8bIAMPFyADDxIAAw8aAAMPGrADDxNgAw8QAAMPE8ADDxkgAw8agAMPF3ADDxHAAw8QAAMPEAADDxAAAw8RkAMPFNADDxOQAw8UcAMPE9ADDxRAAw8QcAMPEAADDxAAAw8QEAMPECADDxAAAw8QAAAAAAAAAAAAAw8QAAMPGIADDx9AAw8bIAMPHhADDxugAw8fEAMPE/ADDxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMPEAADDxaQAw8dMAMPGeADDxxQAw8aUAMPHKADDxLQAw8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADDxAAAw8QYAMPEZADDxEAAw8RgAMPESADDxFQAw8QEAMPEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  // https://www.scholarsatrisk.org/wp-content/themes/sink_sar/images/favicon.ico?v=1785186605
  // image/png, 32×32, 1297 bytes
  "scholars-at-risk":
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAAAAAAAAQCEeRdzAAAEw0lEQVR4nO2XXWgcVRTHz+zczbqpJtE1VKxS0RcR0foFiqL4IEr9Sqyi1SYWBZPWrxcVVCT4IqSoeVBbQftgm2itVFuLVKtW0yKlrUhRS5DS1mDqV5NGTbfb/Zrx/597rjuZ7vpoBL3wY2bvx7nnnHvOubNeGIYyk83M6O7/CgUqlYp794Gn70HimWyclwLVBmN+g3VBUqZBc5vWE9Zo81DnpxIC3VilzjrXfF0TBZ/p6+sLJycnqUkXAvIy9B0Fg+AI+Bkcq7PBmeBsMBxTwo2dBhaBgq45UZWdAlvBiOd5Ui6Xvfb29tD09/dLsVh8FwNZMABOBa+Dk8H5iY19te4RcD84RY4/Jm70IxgCv4NesbF2LvgCrAf3UV5ra6tnoEXH2NhYZzqd9mIpuQVsByeBwzElKqrEzargdeBj7avqnDx4U5VMgzUx5ajQslQqtatUKq3I5XI+g5BWFvGcCwVG1RN0/aMyPZhc0C0En6pVj6kCrjkvufjIxo6BR7oblKHAxeysVquRkG9ABnykWm/WRe8nBLt2J3gITIBnwOnqchcLbi69Udb3I/q8XL2ywwmjAhvAKtCtSvCclsUU8BRaNQ+UAD01pAosBs/J8RnBzWeLPSb2Xw2eAmvFxljkBKPC79UNnwBXqlIMzHvEZoFRIV3gS3CC2NjYBx5UBSpSqyOi8zmvAyxVhSh7Z8yw0Ejt3NYp14MXwG1is2KJWt8ErgX7xaYpPfEruALcAD5UL7gj4LH+ogp+rpZ3qAJpVSiyrBO8pwvKegy7wB5VxlNrGHzbxAanc3dObMA+rAq4dJWYYWzvgOfBk2AMLFeDSgZFgW4fRmQeDoLA1wG696Aq6ATeIjY2nPs4xkBkmt0N5uiatCpXkVoQUu7j4CLwCvYcwfMzPFMGFYn5vBkpcQeeB9Td9MolYL4KuBFcIzYGRDdw1jGiWfl4bHfppjTiLDBLbC2Z0rm307PYi16ej70/Mbm2tmeP5fPNTU1Nr6EO5NW9zeAmsEnP7WkwDl5US/Jq4RInFDC3XwZvi03n38QWntViC9ty7VsIb79aKBRewt4bzc69e98KIi97K8VGbTXmOrb1Sr22Qkm2bQ3ms/E+OE9QdVO4E8ysNWt5fi7Pi/qekVrlcxeNm5OSWrolf8frQCrWFw9IF6ggDM3UG6uXVquV+D0QxgQkBYYJhZJr4vOSfU4RXQvrjR+atk0br2rgqn+kmTAImocGB+ccGh+fSJv00VBCVr5WcAH4SmzAMbWYBT+A7/Q3yyzdSqv+EBtgtPRSsd8U34q1lhfRPP09iQ5TDYLZzdlsuqu7+yBz2X+gt/dWRCUFrFLFzgAXig0mCmVQMp1KOl7WcUY+U2yl9p+jyreLLVDMHH4zMFN+ogJis2cx2NO5YMH3Rjyv0tPTs250dHRuJpNBLYqO/ZBay2AsqvCvtd+1ERUYSi3PeUnxa4mFbEL7mIq8V6IbkV9DqAMftLS0eNls1mclLAwMDLAAHdAFdBtr/AapBRqf+2Kb8/d+Jd7ooS2JefTscGLebjcefZZDIxfV8UgVmV7Xk3U+ngnJD1M3p1FGRXN8349uw+hFpqdNvb9Lyb7kmr9bm/xu/GvOzP8x+V+B/7wCfwILjqASKtPv8gAAAABJRU5ErkJggg==",
};
