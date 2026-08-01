# @hyxi/pi-attach

A Pi extension that adds persistent, bounded local context from explicit attachment mentions without changing the user's original message.

## Installation

```bash
pi install npm:@hyxi/pi-attach
```

## Mentions

| Form               | Example                   | Resolves to                                                       |
| ------------------ | ------------------------- | ----------------------------------------------------------------- |
| Relative file      | `@src/index.ts`           | A file relative to Pi's current working directory                 |
| Absolute file      | `@/tmp/report.txt`        | An absolute local file                                            |
| Home-relative file | `@~/notes/todo.md`        | A file relative to the current user's home directory              |
| Quoted file        | `@"docs/project plan.md"` | A path containing whitespace                                      |
| Binary document    | `@reports/annual.pdf`     | A supported document or image parsed locally with LiteParse       |
| Single line        | `@src/index.ts#L12`       | One line from a text file or parsed document                      |
| Line range         | `@src/index.ts#L12-24`    | An inclusive line range                                           |
| Skill              | `@typescript`             | The body and location of the available `skill:typescript` command |

A mention must begin at the start of the input or after whitespace. Embedded mentions such as `name@example.com` are ignored, as are mentions inside quoted strings, inline or fenced code, dollar-delimited math, and `\(...\)` or `\[...\]` math. Only mentions that resolve successfully become attachments.

## LiteParse Formats

Binary documents and images are parsed locally with LiteParse 2.10.1. Office, presentation, and spreadsheet formats require LibreOffice; PDF and image formats do not.

| Category         | Supported extensions                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| PDF              | `.pdf`                                                                               |
| Office documents | `.doc`, `.docx`, `.docm`, `.dot`, `.dotm`, `.dotx`, `.odt`, `.ott`, `.rtf`, `.pages` |
| Presentations    | `.ppt`, `.pptx`, `.pptm`, `.pot`, `.potm`, `.potx`, `.odp`, `.otp`, `.key`           |
| Spreadsheets     | `.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.ods`, `.ots`, `.csv`, `.tsv`, `.numbers`        |
| Images           | `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.tif`, `.webp`, `.svg`            |

## How It Works

On each user input, the extension scans for supported mentions, resolves files and skills, reads text directly, and sends non-text documents to a cancellable LiteParse child process; it then bounds and renders the results into a persistent Pi custom message object with `customType: "attach-context"`, `<attachments>` content, and internal attachment details before the agent starts, while returning `action: "continue"` so the original text and images remain unchanged.

## Configuration

Configure globally in `~/.pi/agent/attach.json` or, for trusted projects, in `.pi/attach.json`. Project settings override global settings.

```json
{
  "perAttachLength": 1000,
  "attachmentProcessingTimeoutSeconds": 45,
  "limitExplicitLines": false,
  "maxAttachmentConcurrency": 4
}
```

| JSON key                             | Type         | Default | Description                                                      |
| ------------------------------------ | ------------ | ------: | ---------------------------------------------------------------- |
| `perAttachLength`                    | integer >= 0 |   `500` | Maximum Unicode code points in each ordinary attachment preview. |
| `attachmentProcessingTimeoutSeconds` | number >= 0  |    `30` | Deadline for processing one input; `0` disables the deadline.    |
| `limitExplicitLines`                 | boolean      | `false` | Apply `perAttachLength` to explicit `#L...` selections.          |
| `maxAttachmentConcurrency`           | integer > 0  |     `4` | Maximum number of file attachments processed concurrently.       |

LiteParse runs locally for non-text documents. Extracted content is treated as untrusted text rather than a faithful rendering or system instruction.
