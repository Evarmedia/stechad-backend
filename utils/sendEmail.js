const nodemailer = require("nodemailer");
const fs = require("fs");

const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: "no_reply@stechad.com",
    pass: "WBkc8:Zz9&",
  },
  tls: {
    rejectUnauthorized: false,
  },
  debug: true,
  connectionTimeout: 30000, // 30 seconds
});

const sendEmail = async ({ to, subject, htmlFilePath, replacements }) => {
  try {
    // const html = fs
    //   .readFileSync(htmlFilePath, "utf8")
    //   .replace("{{firstname}}", replacements.firstname)
    //   .replace("{{lastname}}", replacements.lastname)
    //   .replace("{{resetCode}}", replacements.resetCode)
    //   .replace("{{url}}", replacements.url)
    //   .replace("{{device}}", replacements.device)
    //   .replace("{{datetime}}", replacements.datetime)
    //   .replace("{{header}}", replacements.header)
    //   .replace("{{tempPassword}}", replacements.tempPassword)
    //   .replace("{{year}}", replacements.year);
    let html = fs.readFileSync(htmlFilePath, "utf8");

    // 🔑 Generic placeholder replacement
    Object.entries(replacements).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, "g");
      html = html.replace(regex, value ?? "");
    });

    await transporter.sendMail({
      from: "no_reply@stechad.com",
      to,
      subject,
      html,
    });
    console.log("Email sent successfully!");
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

module.exports = sendEmail;
