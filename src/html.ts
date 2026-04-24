export function renderIndexHtml(scriptSrc: string, stylesheetSrc: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#fff7df" />
    <title>Classic Games</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${stylesheetSrc}" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="${scriptSrc}"></script>
  </body>
</html>
`;
}
