"use strict";

const compareAsc = require("date-fns/compareAsc");
const mongoose = require("mongoose");
const Parser = require("rss-parser");
const Sentry = require("@sentry/node");
const tweet = require("../lib/tweet");

Sentry.init({
  environment: process.env.NODE_ENV,
  dsn: process.env.SENTRY_DSN,
});
require("../models/Post");
const parser = new Parser();
mongoose
  .connect(process.env.DATABASE_URI, {
    dbName: process.env.DATABASE,
    auth: {
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
    },
  })
  .catch(logError);

function logError(error) {
  if (process.env.NODE_ENV !== "development") {
    Sentry.captureException(error);
  } else {
    console.error(error);
  }
}

module.exports = async (req, res) => {
  const feed = await parser
    .parseURL("http://www.tenkarstavern.com/feeds/posts/default?max-results=10")
    .catch(logError);

  if (!feed) {
    return res.status(404).end("Feed not found.");
  }

  const Post = mongoose.model("Post");

  const promises = feed.items.map(async (item) => {
    const { title, pubDate, link } = item;
    const url = link.replace(/-.*?$/, ""); // only match post ID

    const count = await Post.count({ url });
    if (count == 0) {
      const published_at = new Date(pubDate);
      const newPost = new Post({ title, published_at, url });
      await newPost.save();

      return tweet(`${title} ${url}`).catch(logError);
    } else {
      return null;
    }
  });

  // Delete all posts older than what's in the feed
  const oldestDate = feed.items
    .map(({ pubDate }) => new Date(pubDate))
    .sort(compareAsc)[0];
  promises.push(Post.deleteMany({ published_at: { $lt: oldestDate } }));
  // Clean up any records without URLs
  promises.push(Post.deleteMany({ url: null }));

  await Promise.all(promises).catch(logError);

  res.status(200).end("Finished sending tweets.");
};
