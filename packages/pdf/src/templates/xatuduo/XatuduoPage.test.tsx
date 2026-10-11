import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { pdf } from "../../forme/testing";

type HostNode = { type: string; value?: string; children?: HostNode[] };

const flatten = (node: HostNode): HostNode[] => [node, ...(node.children ?? []).flatMap(flatten)];
const texts = (node: HostNode): string[] =>
	flatten(node).flatMap((child) => (child.type === "TEXT_INSTANCE" && child.value ? [child.value] : []));

const experience = (id: string, position: string, company: string, location: string) => ({
	id,
	hidden: false,
	company,
	position,
	location,
	period: "2020 – 2021",
	website: { url: "https://example.com", label: "", inlineLink: false },
	description: "<ul><li>First point</li><li>Second point</li></ul>",
	roles: [],
});

const renderTexts = async (data: ResumeData) => {
	const element = createElement(ResumeDocument, { data, template: "xatuduo" }) as unknown as Parameters<typeof pdf>[0];
	const instance = pdf(element);
	await expect.poll(() => instance.container.document).not.toBeNull();
	return texts(instance.container.document as unknown as HostNode);
};

describe("Xatuduo experience items", () => {
	it("renders an entry without an employer, and draws no employer line or website for it", async () => {
		const data = structuredClone(defaultResumeData);
		data.picture.hidden = true;
		data.sections.experience.items = [
			experience("with-employer", "Engineer", "Example Corp", "Springfield"),
			experience("without-employer", "Travels abroad", "", ""),
		];
		data.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: [] }];

		const rendered = await renderTexts(data);

		expect(rendered).toContain("Engineer");
		expect(rendered).toContain("Example Corp, Springfield");
		expect(rendered).toContain("Travels abroad");
		expect(rendered.filter((text) => text === "•")).toHaveLength(4);
		expect(rendered).not.toContain(", ");
		expect(rendered.some((text) => text.includes("example.com"))).toBe(false);
	});
});
