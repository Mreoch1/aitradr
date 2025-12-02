import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: true,
});

export async function parseYahooXml(xml: string): Promise<any> {
  try {
    const result = parser.parse(xml);
    return result;
  } catch (error) {
    const snippet = xml.substring(0, 200);
    console.error("XML parsing failed. First 200 chars:", snippet);
    throw new Error("Failed to parse Yahoo XML response");
  }
}

export function normalizeYahooNode(node: any): any {
  if (Array.isArray(node)) {
    return node[0];
  }
  return node;
}

export function findFirstPath(root: any, paths: string[]): any {
  for (const path of paths) {
    const segments = path.split(".");
    let current: any = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const numericMatch = segment.match(/^(\d+)$/);

      if (numericMatch) {
        const index = parseInt(numericMatch[1], 10);
        if (Array.isArray(current) && current[index] !== undefined) {
          current = current[index];
        } else {
          current = null;
          break;
        }
      } else {
        if (current && typeof current === "object" && segment in current) {
          current = current[segment];
        } else {
          current = null;
          break;
        }
      }
    }

    if (current !== null && current !== undefined) {
      return current;
    }
  }

  return null;
}

