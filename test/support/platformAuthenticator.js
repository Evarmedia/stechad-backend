// Independent test authenticator, using RFC 4226 dynamic truncation and RFC 6238's clock.
const { createHmac } = require('node:crypto');
module.exports = (secret, time = Date.now()) => {
  const bits = [...secret].map((char) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5, '0')).join('');
  const bytes = Buffer.from(bits.match(/.{8}/g).map((part) => parseInt(part, 2)));
  const counter = Buffer.from(Math.floor(time / 30000).toString(16).padStart(16, '0'), 'hex');
  const digest = createHmac('sha1', bytes).update(counter).digest('hex');
  const offset = parseInt(digest.at(-1), 16) * 2;
  return String((parseInt(digest.slice(offset, offset + 8), 16) & 0x7fffffff) % 1e6).padStart(6, '0');
};
