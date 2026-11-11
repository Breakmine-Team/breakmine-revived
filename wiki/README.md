# Breakmine Wiki/mods/bugtracker

Track bugs, manage mods, and document Breakmine!

## API

Read-only and unauthenticated, on the mods host only (`mods.breakmine.com`), so
the game client and anything else can read the catalogue without a session. CORS
is open like the rest of the mods app. Errors are JSON too - `{"error": "..."}`
with a matching status - so a client never has to parse an HTML error page.

The bodies below are real captured output, but from a sample database rather
than live data, so the mod names, ids, sizes and usernames in them are
placeholders. Field names, types, key order and status codes are what you
actually get back. `jsonify` sorts keys alphabetically, which is why the order
looks arbitrary.

| Endpoint                      | Returns                                      |
| ----------------------------- | -------------------------------------------- |
| `GET /api/mods`               | `{"count", "mods"}` - newest first           |
| `GET /api/mods/search`        | same, but `q` is required (400 without it)   |
| `GET /api/mods/<id>/files`    | `{"mod", "count", "files"}` - one per version |
| `GET /api/mods/<id>/comments` | `{"mod", "count", "comments"}`               |

`/api/mods` and `/api/mods/search` both take optional `cat` (`mod` or
`texture pack`) and `q` (matched against name and description). Each entry in
`mods` carries `url` and `download_url` as absolute URLs; `/files` gives one
`url` per version with `latest: true` on the current one. Fetching a
`download_url` is what increments `downloads` - reading the API does not.

### `GET /api/mods`

```sh
curl 'https://mods.breakmine.com/api/mods'
```

```json
{
  "count": 2,
  "mods": [
    {
      "author": "demo_author",
      "category": "mod",
      "created_at": "2026-02-11 17:05:00",
      "description": "Adds fireworks that can be launched from the hotbar.",
      "download_url": "https://mods.breakmine.com/download/2/v/3",
      "downloads": 12,
      "file_size": 48310,
      "file_size_formatted": "47.2 KB",
      "id": 2,
      "min_patchwork": null,
      "name": "Fireworks Mod",
      "url": "https://mods.breakmine.com/view/2",
      "version": "2.0.1"
    },
    {
      "author": "demo_author",
      "category": "texture pack",
      "created_at": "2026-01-04 09:12:00",
      "description": "Higher resolution textures, includes a 2x and 4x variant.",
      "download_url": "https://mods.breakmine.com/download/1/v/1",
      "downloads": 128,
      "file_size": 2411724,
      "file_size_formatted": "2.3 MB",
      "id": 1,
      "min_patchwork": "1.3.2-beta",
      "name": "Zoom Pack",
      "url": "https://mods.breakmine.com/view/1",
      "version": "1.1.0"
    }
  ]
}
```

`min_patchwork` is `null` when the mod declares no minimum, matching the "Any
version" the page shows. `cat=mod` or `cat=texture%20pack` filters it; `q` does
the same search as `/api/mods/search`.

### `GET /api/mods/search`

```sh
curl 'https://mods.breakmine.com/api/mods/search?q=zoom'
```

```json
{
  "count": 1,
  "mods": [
    {
      "author": "demo_author",
      "category": "texture pack",
      "created_at": "2026-01-04 09:12:00",
      "description": "Higher resolution textures, includes a 2x and 4x variant.",
      "download_url": "https://mods.breakmine.com/download/1/v/1",
      "downloads": 128,
      "file_size": 2411724,
      "file_size_formatted": "2.3 MB",
      "id": 1,
      "min_patchwork": "1.3.2-beta",
      "name": "Zoom Pack",
      "url": "https://mods.breakmine.com/view/1",
      "version": "1.1.0"
    }
  ]
}
```

### `GET /api/mods/<id>/files`

Newest version first.

```sh
curl 'https://mods.breakmine.com/api/mods/1/files'
```

```json
{
  "count": 2,
  "files": [
    {
      "created_at": "2026-01-04 09:12:00",
      "file_size": 2411724,
      "file_size_formatted": "2.3 MB",
      "filename": "ZoomPack-1.1.0.zip",
      "latest": true,
      "url": "https://mods.breakmine.com/download/1/v/1",
      "version": "1.1.0"
    },
    {
      "created_at": "2026-01-02 18:40:00",
      "file_size": 1205862,
      "file_size_formatted": "1.1 MB",
      "filename": "ZoomPack-1.0.0.zip",
      "latest": false,
      "url": "https://mods.breakmine.com/download/1/v/2",
      "version": "1.0.0"
    }
  ],
  "mod": {
    "id": 1,
    "name": "Zoom Pack",
    "version": "1.1.0"
  }
}
```

`filename` is the name the file downloads as. The stored on-disk name is never
exposed.

### `GET /api/mods/<id>/comments`

Oldest first, as the page shows them.

```sh
curl 'https://mods.breakmine.com/api/mods/1/comments'
```

```json
{
  "comments": [
    {
      "author": "demo_author",
      "content": "Thanks for the 4x variant...",
      "created_at": "2026-01-05 20:03:00",
      "id": 1
    },
    {
      "author": "kai",
      "content": "Loading the 2x pack on a mid-range laptop is fine.",
      "created_at": "2026-01-06 08:15:00",
      "id": 2
    }
  ],
  "count": 2,
  "mod": {
    "id": 1,
    "name": "Zoom Pack"
  }
}
```

### Possible Errors

```sh
curl 'https://mods.breakmine.com/api/mods/search'      # 400
curl 'https://mods.breakmine.com/api/mods?cat=bogus'    # 400
curl 'https://mods.breakmine.com/api/mods/999/files'    # 404
```

```json
{ "error": "Missing required query parameter: q" }
```

```json
{ "error": "Unknown category 'bogus'. Expected 'mod' or 'texture pack'." }
```

```json
{ "error": "Mod not found" }
```