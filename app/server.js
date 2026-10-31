/**
 * Production entry point for hosts that start a Node.js file directly
 * (cPanel "Setup Node.js App", Plesk, Phusion Passenger, PM2).
 *
 * Run `npm run build` first. On a VPS you can also use `npm start` instead.
 */
const { createServer } = require("node:http");
const path = require("node:path");

// Hosting panels often start the app from another folder; resolve everything from here.
process.chdir(__dirname);
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const next = require("next");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOST || "0.0.0.0";
const app = next({ dev: false, dir: path.resolve(__dirname), hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res)).listen(port, hostname, () => {
      console.log(`> Dialzen is running on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error("> Dialzen failed to start:", error);
    process.exit(1);
  });
