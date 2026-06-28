// Minimal streaming RFC-4180 CSV reader: yields each row as an array of field
// strings. Handles quoted fields, embedded commas/newlines, and "" escapes.
// Streaming so multi-GB files (RecipeNLG is ~2GB) never load into memory.

export async function* readCsvRows(stream) {
  let field = '';
  let row = [];
  let inQuotes = false;
  let prevQuoteInField = false; // tracks a quote that may be an escape or a close

  for await (const chunk of stream) {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (prevQuoteInField) {
            field += '"'; // escaped quote
            prevQuoteInField = false;
          } else {
            prevQuoteInField = true; // could be close or escape; decide next char
          }
        } else if (prevQuoteInField) {
          inQuotes = false;
          prevQuoteInField = false;
          // reprocess this char outside quotes
          i--;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        field = '';
        // ignore a trailing \r already stripped below
        yield row.map((f) => (f.endsWith('\r') ? f.slice(0, -1) : f));
        row = [];
      } else {
        field += c;
      }
    }
  }
  // flush final field/row if the file didn't end with a newline
  if (field.length || row.length) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    yield row;
  }
}
