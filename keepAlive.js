import express from "express";
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running 24/7!");
});

export function keepAlive() {
  app.listen(3000, () => {
    console.log("🟢 KeepAlive Server Running");
  });
}
