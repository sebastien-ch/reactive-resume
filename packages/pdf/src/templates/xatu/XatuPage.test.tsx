import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act, createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { renderToBuffer } from "../../forme/testing";

const HEADLINE = Array.from({ length: 12 }, (_, index) => `Experience ${index} designing accessible applications`).join(
	" ",
);

const baseData = () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Audit";
	data.picture.hidden = true;
	data.metadata.page.locale = "en-US";
	data.metadata.page.marginX = 30;
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: "@version 1;" } };
	data.metadata.layout.pages = [{ fullWidth: true, main: [], sidebar: [] }];
	return data;
};

const renderLines = async (data: ResumeData) => {
	const element = createElement(ResumeDocument, { data, template: "xatu" }) as unknown as Parameters<
		typeof renderToBuffer
	>[0];
	let bytes: Uint8Array = new Uint8Array();
	await act(async () => {
		bytes = new Uint8Array(await renderToBuffer(element));
	});
	const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
	try {
		const document = await loadingTask.promise;
		const page = await document.getPage(1);
		const content = await page.getTextContent();
		return content.items.filter(
			(item): item is TextItem => "str" in item && item.str !== "Audit" && Boolean(item.str.trim()),
		);
	} finally {
		await loadingTask.destroy();
	}
};

const plainText = (lines: TextItem[]) =>
	lines
		.map((line) => line.str)
		.join(" ")
		.replace(/\s+/g, " ");

describe("Xatu one-column layout", () => {
	it("keeps the complete headline within page margins", async () => {
		const data = baseData();
		data.basics.headline = HEADLINE;
		const lines = await renderLines(data);
		expect(plainText(lines)).toBe(HEADLINE);
		for (const line of lines) {
			expect(line.transform[4]).toBeGreaterThanOrEqual(29.9);
			expect(line.transform[4] + line.width).toBeLessThanOrEqual(565.38);
		}
	});

	it("reads each dated entry as one title line, then plain labelled lines", async () => {
		const data = baseData();
		data.basics.headline = "";
		data.sections.experience.items = [
			{
				id: "experience-1",
				hidden: false,
				company: "Example Corp",
				position: "Engineer",
				location: "Remote",
				period: "2020 - 2022",
				website: { url: "", label: "", inlineLink: false },
				description: "<ul><li><p>Built things</p></li></ul>",
				roles: [],
			},
		];
		data.sections.languages.items = [
			{ id: "language-1", hidden: false, language: "English", fluency: "Native", level: 0 },
			{ id: "language-2", hidden: false, language: "German", fluency: "B1", level: 0 },
		];
		data.sections.skills.items = [
			{
				id: "skill-1",
				hidden: false,
				icon: "",
				iconColor: "",
				name: "Tools",
				proficiency: "",
				level: 0,
				keywords: ["Alpha", "Beta"],
			},
		];
		data.metadata.layout.pages = [{ fullWidth: true, main: ["experience", "languages", "skills"], sidebar: [] }];
		const text = plainText(await renderLines(data));

		expect(text).toContain("Example Corp (Remote) | Engineer | 2020 - 2022");
		expect(text).toContain("Built things");
		expect(text.match(/Built things/g)).toHaveLength(1);
		// Languages right before skills print as the skills section's first line.
		expect(text.indexOf("Languages : English (Native) · German (B1)")).toBeGreaterThan(text.indexOf("Skills"));
		expect(text).toContain("Tools : Alpha · Beta");
	});

	it("drops empty title segments with their separators and parentheses", async () => {
		const data = baseData();
		data.basics.headline = "";
		data.sections.experience.items = [
			{
				id: "experience-1",
				hidden: false,
				company: "Example Corp",
				position: "",
				location: "",
				period: "",
				website: { url: "", label: "", inlineLink: false },
				description: "",
				roles: [],
			},
		];
		data.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: [] }];
		const text = plainText(await renderLines(data));

		expect(text).toContain("Example Corp");
		expect(text).not.toMatch(/\||\(\s*\)/);
	});

	it("prints interests without keywords on one line", async () => {
		const data = baseData();
		data.basics.headline = "";
		data.sections.interests.items = ["Hiking", "Chess"].map((name, index) => ({
			id: `interest-${index}`,
			hidden: false,
			icon: "",
			iconColor: "",
			name,
			keywords: [],
		}));
		data.metadata.layout.pages = [{ fullWidth: true, main: ["interests"], sidebar: [] }];
		const lines = await renderLines(data);

		expect(lines.some((line) => line.str === "Hiking · Chess")).toBe(true);
	});
});
