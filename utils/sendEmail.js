const nodemailer = require("nodemailer");
const fs = require("fs");

const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL.USER,
    pass: process.env.EMAIL_PASS, // Old password changed
  },
  tls: {
    rejectUnauthorized: true,
  },
  debug: true,
  connectionTimeout: 30000, // 30 seconds
});

const sendEmail = async ({ to, subject, htmlFilePath, replacements }) => {
  try {
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
