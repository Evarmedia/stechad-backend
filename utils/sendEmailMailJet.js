const fs = require("fs");
const Mailjet = require("node-mailjet");

const mailjet = Mailjet.apiConnect(
  process.env.MJ_APIKEY_PUBLIC,
  process.env.MJ_APIKEY_PRIVATE,
);

/**
 * Send email via Mailjet
 *
 * @param {Object} options
 * @param {string|string[]} options.to - recipient email or array of emails
 * @param {string} options.subject
 * @param {string} options.htmlFilePath - path to HTML template
 * @param {Object} options.replacements - {{key}} replacements
 */
const sendEmail = async ({ to, subject, htmlFilePath, replacements = {} }) => {
  try {
    let html = fs.readFileSync(htmlFilePath, "utf8");

    // 🔑 Generic placeholder replacement
    Object.entries(replacements).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, "g");
      html = html.replace(regex, value ?? "");
    });

    // Normalize recipients
    const recipients = Array.isArray(to)
      ? to.map((email) => ({ Email: email }))
      : [{ Email: to }];

    const response = await mailjet.post("send", { version: "v3.1" }).request({
      Messages: [
        {
          From: {
            Email: "no_reply@stechad.com",
            Name: "Stechad",
          },
          To: recipients,
          Subject: subject,
          HTMLPart: html,
        },
      ],
    });

    console.log("Email sent successfully via Mailjet!");
    return response.body;
  } catch (error) {
    console.error(
      "Mailjet send error:",
      error?.response?.data || error.message,
    );
    throw error;
  }
};

module.exports = sendEmail;
