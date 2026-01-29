const fs = require("fs");

// Read the JSON file (your Google service key)
fs.readFile("./config/googleServiceKey.json", "utf8", (err, data) => {
  if (err) {
    console.error("Error reading the JSON file:", err);
    return;
  }

  // Parse the JSON data
  const credentials = JSON.parse(data);

  // Stringify the JSON with properly escaped quotes and newlines
  const stringifiedCredentials = JSON.stringify(credentials);

  // Log or save the result to use in your .env file
  console.log(
    'GOOGLE_APPLICATION_CREDENTIALS="' + stringifiedCredentials + '"',
  );
});
