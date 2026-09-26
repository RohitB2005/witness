// A small fictional "library" site with deliberate bugs, for Explorer / edge-input / scan tests.
// (Generic on purpose: nothing here mirrors the benchmark app.)
// - /books: "Price: low to high" sorts prices as text ($100 before $20).
// - /request: the request form. Server: 500 when the name has an apostrophe; no server-side check for an
//   empty name (the field is only aria-required); the thank-you message inserts the name as HTML; the
//   submit button isn't disabled, so a double click sends two requests.
import type { IncomingMessage } from "node:http";
import { page, startFixtureServer, type FixtureServer } from "./fixture-server";

const nav = `<nav aria-label="Main"><ul><li><a href="/">Home</a></li><li><a href="/books">Books</a></li><li><a href="/request">Request a book</a></li></ul></nav>`;

export interface LibrarySite extends FixtureServer {
  posts: { name: string; email: string }[];
}

export async function startLibrarySite(): Promise<LibrarySite> {
  const posts: { name: string; email: string }[] = [];
  const srv = await startFixtureServer({
    "/": { body: page(`${nav}<p>Welcome to the library catalogue.</p>`, { title: "Library" }) },
    "/books": {
      body: page(
        `${nav}
        <label for="sort">Sort by</label>
        <select id="sort"><option>Title</option><option>Price: low to high</option></select>
        <ul aria-label="Books" id="list">
          <li><h2>Atlas</h2><p>$20 late fee</p></li>
          <li><h2>Bestiary</h2><p>$100 late fee</p></li>
          <li><h2>Codex</h2><p>$8 late fee</p></li>
        </ul>
        <script>
          document.getElementById("sort").addEventListener("change", function (e) {
            var list = document.getElementById("list");
            var items = Array.prototype.slice.call(list.children);
            items.sort(function (a, b) {
              if (e.target.value === "Title") return a.textContent.localeCompare(b.textContent);
              return a.querySelector("p").textContent.localeCompare(b.querySelector("p").textContent); // bug: text sort
            });
            items.forEach(function (i) { list.appendChild(i); });
          });
        </script>`,
        { title: "Books" },
      ),
    },
    "/request": {
      body: page(
        `${nav}
        <form id="f" aria-label="Request a book">
          <label for="name">Full name</label><input id="name" name="name" aria-required="true">
          <label for="email">Email</label><input id="email" name="email" type="email">
          <label for="branch">Branch</label><input id="branch" name="branch" value="Central">
          <button type="submit">Send request</button>
        </form>
        <div id="out" role="status"></div>
        <script>
          document.getElementById("f").addEventListener("submit", function (e) {
            e.preventDefault();
            var name = document.getElementById("name").value;
            var email = document.getElementById("email").value;
            fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name, email: email }) })
              .then(function (r) {
                if (!r.ok) { document.getElementById("out").textContent = "Something went wrong"; return; }
                document.getElementById("out").innerHTML = "<p>Request received</p><p>Thanks, " + name + "</p>";
              });
          });
        </script>`,
        { title: "Request a book" },
      ),
    },
    "POST /api/requests": (req: IncomingMessage) => {
      const body = (req as IncomingMessage & { body?: string }).body ?? "";
      let data: { name?: string; email?: string } = {};
      try {
        data = JSON.parse(body) as typeof data;
      } catch {
        // ignore
      }
      if ((data.name ?? "").includes("'"))
        return { status: 500, body: '{"error":"db"}', contentType: "application/json" };
      posts.push({ name: data.name ?? "", email: data.email ?? "" });
      return { status: 201, body: "{}", contentType: "application/json" };
    },
  });
  return Object.assign(srv, { posts });
}
