# @hyxi/pi-attach

A Pi extension that adds persistent, bounded context from explicit file, URL, and skill attachment mentions without changing the user's original message.

## Installation

```bash
pi install npm:@hyxi/pi-attach
```

## Configuration

Configure globally in `~/.pi/agent/extensions/attach.json` or, for trusted projects, in `.pi/extensions/attach.json`. Project settings override global settings.

```json
{
  "perAttachLength": 1000,
  "attachmentProcessingTimeoutSeconds": 45,
  "limitExplicitLines": false,
  "maxAttachmentConcurrency": 4,
  "temporaryDirectory": "/tmp"
}
```

| JSON key                             | Type             |     Default | Description                                                          |
| ------------------------------------ | ---------------- | ----------: | -------------------------------------------------------------------- |
| `perAttachLength`                    | integer >= 0     |       `500` | Maximum Unicode code points in each ordinary attachment preview.     |
| `attachmentProcessingTimeoutSeconds` | number >= 0      |        `30` | Deadline for processing one input; `0` disables the deadline.        |
| `limitExplicitLines`                 | boolean          |     `false` | Apply `perAttachLength` to explicit `#L...` selections.              |
| `maxAttachmentConcurrency`           | integer > 0      |         `4` | Maximum number of file or URL attachments processed concurrently.    |
| `temporaryDirectory`                 | non-empty string | OS temp dir | Base directory for private per-conversion `pi-attach-*` directories. |

## Mentions

| Form               | Example                        | Resolves to                                                       |
| ------------------ | ------------------------------ | ----------------------------------------------------------------- |
| Relative file      | `@src/index.ts`                | A file relative to Pi's current working directory                 |
| Absolute file      | `@/tmp/report.txt`             | An absolute local file                                            |
| Home-relative file | `@~/notes/todo.md`             | A file relative to the current user's home directory              |
| Quoted file        | `@"docs/project plan.md"`      | A path containing whitespace                                      |
| Document           | `@reports/annual.pdf`          | A supported document converted locally to Markdown with Markit    |
| URL                | `@https://example.com/article` | HTTP(S) content negotiated or converted to Markdown with Markit   |
| Single line        | `@src/index.ts#L12`            | One line from text or converted Markdown                          |
| Line range         | `@src/index.ts#L12-24`         | An inclusive line range                                           |
| Skill              | `@typescript`                  | The body and location of the available `skill:typescript` command |

A mention must begin at the start of the input or after whitespace. Embedded mentions such as `name@example.com` are ignored, as are mentions inside quoted strings, inline or fenced code, dollar-delimited math, and `\(...\)` or `\[...\]` math. Only mentions that resolve successfully become attachments.

## Supported File Formats

Markit converts supported document and data files to Markdown locally. Image descriptions and audio transcription are not enabled by this extension, so those formats provide the metadata Markit can extract without an LLM.

| Category       | Supported extensions                                                      |
| -------------- | ------------------------------------------------------------------------- |
| Documents      | `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.html`, `.htm`, `.epub`, `.ipynb`     |
| Data and feeds | `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`, `.xml`, `.svg`, `.rss`, `.atom` |
| Images         | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`                                  |
| Audio          | `.mp3`, `.wav`, `.m4a`, `.flac`                                           |
| Archives       | `.zip`                                                                    |

Ordinary UTF-8 text and source code remain source-accurate instead of being wrapped or reformatted, preserving useful `#L...` semantics.

## URL Processing

For `@http://...` and `@https://...` mentions, Markit requests Markdown first. URI fragments, including fragments such as `#L12-24`, are passed to the server unchanged and are never interpreted as attachment line selectors. Markit uses a Markdown response directly; for HTML it checks for an advertised Markdown source, VitePress Markdown, or a root `llms.txt`, then converts the HTML to Markdown when no Markdown source is available. Other supported response formats are converted according to their content type or URL extension.

URL mentions perform network requests and may follow redirects. Attach only URLs you trust the local Pi process to access.

## How It Works

On each user input, the extension scans for supported mentions, resolves files, URLs, and skills, reads ordinary text directly, and sends convertible sources to a cancellable Markit child process. Generated Markdown is saved to a private temporary `parsed.md` file, then bounded and rendered into a persistent Pi custom message with `customType: "attach-context"` before the agent starts. The extension returns `action: "continue"`, so the original text and images remain unchanged.

Extracted content is treated as untrusted text rather than a faithful rendering or system instruction.
