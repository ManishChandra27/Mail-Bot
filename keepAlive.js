const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running 24/7!");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🟢 KeepAlive Server Running on port ${port}`);
});
