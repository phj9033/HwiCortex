import { describe, it, expect } from "vitest";
import { feedItemToDiscovery } from "../../../src/research/sources/rss.js";

describe("feedItemToDiscovery", () => {
  it("maps an rss item with link, title, isoDate, contentSnippet", () => {
    const out = feedItemToDiscovery(
      {
        link: "https://blog.example.com/post-1",
        title: "Post One",
        isoDate: "2026-04-30T12:00:00Z",
        contentSnippet: "Snippet text...",
      },
      "https://blog.example.com/feed.xml",
    );
    expect(out).toEqual({
      url: "https://blog.example.com/post-1",
      hint_title: "Post One",
      source_meta: {
        adapter: "rss",
        feed: "https://blog.example.com/feed.xml",
        pubDate: "2026-04-30T12:00:00Z",
        content_snippet: "Snippet text...",
      },
    });
  });

  it("returns null when link is missing (rss-parser sets it as undefined)", () => {
    const out = feedItemToDiscovery(
      { title: "Linkless" },
      "https://x/feed.xml",
    );
    expect(out).toBeNull();
  });

  it("uses null for absent isoDate / contentSnippet rather than undefined", () => {
    const out = feedItemToDiscovery(
      { link: "https://x.com/a", title: "T" },
      "https://x/feed.xml",
    );
    expect(out?.source_meta).toMatchObject({ pubDate: null, content_snippet: null });
  });
});
