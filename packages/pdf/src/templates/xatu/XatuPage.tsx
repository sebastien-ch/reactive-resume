import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateStyleSlots } from "../shared/types";
import type {
	CustomSection,
	EducationItem,
	ExperienceItem,
	InterestItem,
	LanguageItem,
	ProjectItem,
	SkillItem,
} from "@reactive-resume/schema/resume/data";
import type { HTMLElement, Node as HTMLNode } from "node-html-parser";
import type { ReactNode } from "react";
import { NodeType, parse } from "node-html-parser";
import { Children, createContext, Fragment, useContext, useMemo } from "react";
import { Link, Page, StyleSheet, Svg, Text, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { PhosphorIcon } from "../../forme/icons";
import { toColor } from "../../forme/style";
import { getResumeSectionTitle } from "../../section-title";
import {
	SemanticNodeKeyProvider,
	useRenderedSectionIds,
	useResolvedNode,
	useSemanticNodeVisible,
	useSemanticSectionNodeKey,
} from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { TemplateProvider } from "../shared/context";
import { filterSections } from "../shared/filtering";
import { hasTemplatePicture } from "../shared/picture";
import { SemanticHeaderPicture, SemanticHeaderView, SemanticRegionView } from "../shared/primitives";
import { Section } from "../shared/sections";
import { SidebarBackground } from "../shared/sidebar-background";
import { composeStyles } from "../shared/styles";
import { useTemplateBase } from "../shared/template-base";

// One column: every section, main then sidebar, is stacked in one reading order. Rows only in the header (name and
// squares beside headline and contact lines, icon beside text) and for bullets. Type scale in PDF points (the source mockup's 12 px is 9 pt).
const MIN_SIZE = 9;
const BODY_SIZE = 10;
const BODY_LINE_HEIGHT = 1.3;
const TITLE_LINE_SIZE = 10.5;
const SECTION_HEADING_SIZE = 16;
// Tuned when the headline spanned a single contact line; the right block now takes the headline's width.
const HEADLINE_SIZE = 13.2;
const CONTACT_SIZE = 10;
// Width of the real space drawn between contact words and around their "·", in points: the space glyph sits in a
// fixed box, untracked, so extractors read a space and the words keep the spacing they had with a 3 pt gap.
const CONTACT_SPACE_WIDTH = 3;
// Same real space between two contact items, wider so the next icon reads as the separator.
const CONTACT_ITEM_GAP = 8;
// Least width of each contact line's first item, icon included, so the second items' icons line up across lines.
// Tuned to the current phone item, the widest first item; Forme can't measure text here.
const CONTACT_FIRST_ITEM_WIDTH = 88.45;
// Tighter letters on the header's right block, in points. Contact words are drawn apart, so their spaces don't
// shrink; the headline keeps real spaces, and tighter than -0.3 makes Poppler's raw text mode glue its words.
const HEADER_LETTER_SPACING = -0.4;
const HEADLINE_LETTER_SPACING = -0.3;
const NAME_SIZE = 28;
// Space above both header columns: where the earlier centred row put the name, kept so the squares and the first
// section stay where they were.
const HEADER_TOP_OFFSET = 3.75;
// Moves the right block down until its first line's ink starts at the name's capitals, not the accent above the É
// (measured on the rendered page with the Novecento Cond name; both columns start at the row's top).
const HEADER_DETAILS_DROP = 0.25;
// Name and section headings. Not a web font: only a local render that hands Forme this face uses it; elsewhere they
// fall back to the heading font.
const NAME_FONT_FAMILY = "Novecento Cond";
const SECTION_GAP = 10 * 1.25;
const ITEM_GAP = 4;
const SEPARATOR = " · ";
const BULLET_SIZE = 4;
const BULLET_INDENT = 12;
// Row of coloured squares under the name, in place of a rule. 52.5 mm wide in points, height from the 80 × 10 view
// box; the first square takes the resume's primary colour, the others keep fixed colours. Gaps in points: above it
// (under the name: the earlier row gap of 1 and centring offset included) and below it, before the first section.
const MM = 72 / 25.4;
const HEADER_RULE_VIEW_BOX = { width: 80, height: 10 };
const HEADER_RULE_WIDTH = 52.5 * MM;
const HEADER_RULE_HEIGHT = (HEADER_RULE_WIDTH * HEADER_RULE_VIEW_BOX.height) / HEADER_RULE_VIEW_BOX.width;
const HEADER_RULE_GAP_ABOVE = 5.25;
const HEADER_RULE_GAP_BELOW = 19.53125 * 1.5;
const HEADER_RULE_SQUARES: { x: number; fill?: string }[] = [
	{ x: 0 },
	{ x: 10, fill: "#111111" },
	{ x: 33, fill: "#BE1E2D" },
	{ x: 50, fill: "#111111" },
	{ x: 70, fill: "#F9B928" },
];

/**
 * How many bullets come before each description on the page, keyed by `bulletKey`, so the squares take the bullet
 * colours in turn across every list, in reading order.
 */
const BulletOffsetsContext = createContext<ReadonlyMap<string, number>>(new Map());

/** Sections this template draws itself; any other section falls back to the shared renderer. */
const OWN_SECTIONS = new Set(["summary", "experience", "projects", "education", "skills", "languages", "interests"]);

type XatuStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerName: Style;
	headerHeadline: Style;
	headerRow: Style;
	headerIdentity: Style;
	headerNameSpace: Style;
	headerDetails: Style;
	headerContactList: Style;
	headerContactItem: Style;
	headerContactWords: Style;
	headerContactSpace: Style;
	headerContactItemSpace: Style;
	headerContactFirstItem: Style;
	headerContactIcon: { size: number; color: string; display: "none" | "flex" };
	headerContact: Style;
	headerRule: { content: string; style: Style };
	body: Style;
	ownSection: Style;
	ownSectionHeading: Style;
	ownItems: Style;
	ownItem: Style;
	itemHeader: Style;
	itemTitleLine: Style;
	itemOrganization: Style;
	itemPosition: Style;
	itemExtra: Style;
	labelledLine: Style;
	interestsLine: Style;
	lineLabel: Style;
	descriptionBold: Style;
	bulletRow: Style;
	bulletMarker: Style;
	bulletColors: string[];
	bulletContent: Style;
};

type XatuTemplate = {
	colors: TemplateColorRoles;
	styles: XatuStyles;
};

type XatuStylesProps = {
	styles: XatuStyles;
};

type SectionBaseProps = XatuStylesProps & {
	pageNodeKey: string;
};

type OwnSectionProps = SectionBaseProps & {
	sectionId: string;
	title: string;
	children: ReactNode;
};

type SectionRendererProps = SectionBaseProps & {
	section: string;
	placement: "main" | "sidebar";
	mergeLanguages: boolean;
};

type SkillsSectionProps = SectionBaseProps & {
	sectionId: string;
	section: { title: string; hidden: boolean; items: SkillItem[] };
	mergeLanguages: boolean;
};

type TitleLineProps = XatuStylesProps & {
	organization: string;
	detail?: string | undefined;
	position?: string | undefined;
	period?: string | undefined;
};

type DatedItemProps = TitleLineProps & {
	description: string;
	bulletKey: string;
	extra?: string | undefined;
	itemNodeKey?: string | undefined;
};

type LabelledLineProps = XatuStylesProps & {
	label: string;
	values: string[];
};

type ContactEntry = { key: string; icon: string; text: string; href?: string | undefined };

type ContactListProps = XatuStylesProps & {
	contacts: ContactEntry[];
};

type DescriptionRun = { text: string; bold: boolean };

type DescriptionBlock = { kind: "bullet" | "paragraph"; text: string; runs: DescriptionRun[] };

type DescriptionProps = XatuStylesProps & {
	html: string;
	/** Where the description sits in reading order; see `countBulletsBefore`. */
	bulletKey: string;
};

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

const joinText = (values: (string | undefined)[], separator: string) => values.filter(hasText).join(separator);

const isInsideListItem = (element: HTMLElement) => {
	for (let parent = element.parentNode; parent; parent = parent.parentNode) {
		if (parent.rawTagName?.toLowerCase() === "li") return true;
	}
	return false;
};

const BOLD_TAGS = new Set(["strong", "b"]);

/** An element's text as runs, bold inside `<strong>` or `<b>`; other inline markup is dropped. */
const collectRuns = (node: HTMLNode, bold: boolean, runs: DescriptionRun[]) => {
	if (node.nodeType === NodeType.TEXT_NODE) {
		runs.push({ text: node.text, bold });
		return;
	}
	const tag = (node as HTMLElement).rawTagName?.toLowerCase();
	for (const child of node.childNodes) collectRuns(child, bold || (tag !== undefined && BOLD_TAGS.has(tag)), runs);
};

/** Collapses white space across runs as one line of text would, then merges neighbours of the same weight. */
const normalizeRuns = (runs: DescriptionRun[]) => {
	const merged: DescriptionRun[] = [];
	for (const run of runs) {
		const previous = merged.at(-1);
		let text = run.text.replace(/\s+/g, " ");
		if ((previous === undefined || previous.text.endsWith(" ")) && text.startsWith(" ")) text = text.slice(1);
		if (text.length === 0) continue;
		if (previous?.bold === run.bold) previous.text += text;
		else merged.push({ text, bold: run.bold });
	}
	const last = merged.at(-1);
	if (last) {
		last.text = last.text.trimEnd();
		if (last.text.length === 0) merged.pop();
	}
	return merged;
};

/** Reads a description's list items as bullets and its paragraphs as lines; only bold survives as inline markup. */
const readDescription = (html: string): DescriptionBlock[] =>
	parse(html)
		.querySelectorAll("li, p")
		.filter((element) => element.rawTagName.toLowerCase() === "li" || !isInsideListItem(element))
		.map((element): DescriptionBlock => {
			const runs: DescriptionRun[] = [];
			collectRuns(element, false, runs);
			return {
				kind: element.rawTagName.toLowerCase() === "li" ? "bullet" : "paragraph",
				text: element.text.replace(/\s+/g, " ").trim(),
				runs: normalizeRuns(runs),
			};
		})
		.filter((block) => hasText(block.text));

const experienceItems = (items: ExperienceItem[]) =>
	items.filter((item) => !item.hidden && (hasText(item.position) || hasText(item.company)));
const experienceRoles = (item: ExperienceItem) =>
	item.roles.filter((role) => hasText(role.position) || hasText(role.period));
const projectItems = (items: ProjectItem[]) => items.filter((item) => !item.hidden && hasText(item.name));
const educationItems = (items: EducationItem[]) =>
	items.filter((item) => !item.hidden && (hasText(item.school) || hasText(item.degree)));

const countBullets = (html: string) =>
	hasText(html) ? readDescription(html).filter((block) => block.kind === "bullet").length : 0;

/**
 * Walks the descriptions this template draws, in the order the sections print them, and returns how many bullets
 * precede each one. Mirrors the sections' own filters, so a hidden item or empty description adds nothing.
 */
const countBulletsBefore = (sections: string[], data: ReturnType<typeof useRender>) => {
	const offsets = new Map<string, number>();
	let total = 0;
	const add = (key: string, html: string) => {
		offsets.set(key, total);
		total += countBullets(html);
	};
	for (const section of sections) {
		if (section === "summary" && !data.summary.hidden) add("summary", data.summary.content);
		if (section === "experience" && !data.sections.experience.hidden) {
			for (const item of experienceItems(data.sections.experience.items)) {
				const roles = experienceRoles(item);
				if (roles.length === 0) add(item.id, item.description);
				else {
					for (const role of roles) add(`${item.id}-${role.id}`, role.description);
					add(`${item.id}-description`, item.description);
				}
			}
		}
		if (section === "projects" && !data.sections.projects.hidden)
			for (const item of projectItems(data.sections.projects.items)) add(item.id, item.description);
		if (section === "education" && !data.sections.education.hidden)
			for (const item of educationItems(data.sections.education.items)) add(item.id, item.description);
	}
	return offsets;
};

const isSkillsSection = (id: string | undefined, customSections: CustomSection[]) =>
	id === "skills" || customSections.some((custom) => custom.id === id && custom.type === "skills");

export const XatuPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { colors, styles } = useXatuTemplate();
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));
	const sections = page.fullWidth ? mainSections : [...mainSections, ...sidebarSections];
	// Languages placed right before a skills section print as that section's first line instead of on their own.
	const languagesIndex = sections.indexOf("languages");
	const mergeLanguages = languagesIndex >= 0 && isSkillsSection(sections[languagesIndex + 1], data.customSections);
	const mergedInto = mergeLanguages ? sections[languagesIndex + 1] : undefined;
	const bulletOffsets = countBulletsBefore(sections, data);

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			{/* Forme doesn't paint a page's own background colour: a full-width band does, margins included. */}
			<SidebarBackground color={colors.background} width="100%" />
			<BulletOffsetsContext.Provider value={bulletOffsets}>
				<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
					{showHeader && <Header styles={styles} />}

					<SemanticRegionView region="main" style={styles.body}>
						{sections.map((section) =>
							mergeLanguages && section === "languages" ? null : (
								<SectionRenderer
									key={section}
									section={section}
									placement={mainSections.includes(section) ? "main" : "sidebar"}
									pageNodeKey={pageNodeKey}
									mergeLanguages={section === mergedInto}
									styles={styles}
								/>
							),
						)}
					</SemanticRegionView>
				</TemplateProvider>
			</BulletOffsetsContext.Provider>
		</Page>
	);
};

const Header = ({ styles }: XatuStylesProps) => {
	const { basics, picture } = useRender();
	const website = hasText(basics.website.label) ? basics.website.label : basics.website.url;
	const contacts: ContactEntry[] = [
		{ key: "phone", icon: "phone", text: basics.phone, href: `tel:${basics.phone.replace(/\s+/g, "")}` },
		{ key: "email", icon: "envelope", text: basics.email, href: `mailto:${basics.email.trim()}` },
		{ key: "location", icon: "map-pin", text: basics.location },
		{ key: "website", icon: "globe", text: website },
	].filter((contact) => hasText(contact.text));
	const customFields: ContactEntry[] = basics.customFields
		.map((field) => ({ key: field.id, icon: field.icon, text: field.text }))
		.filter((contact) => hasText(contact.text));
	const headlineLines = basics.headline.split(/\r?\n/).filter(hasText);

	return (
		<SemanticHeaderView style={styles.header}>
			{/* Name and squares on the left, headline and contact lines on the right; each side is one text column, name
			    first, so the right lines run down beside the squares. */}
			<View style={styles.headerRow}>
				{hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
				<View style={styles.headerIdentity}>
					<Text style={styles.headerName}>
						{/* Poppler's raw text mode drops Novecento's word space; the fallback font's space survives. */}
						{basics.name
							.trim()
							.split(/\s+/)
							.map((word, index) => (
								// oxlint-disable-next-line react/no-array-index-key -- words are positional and never reorder.
								<Fragment key={index}>
									{index > 0 && <Text style={styles.headerNameSpace}> </Text>}
									{word}
								</Fragment>
							))}
					</Text>
					{/* Drawn once, as shapes only: it adds nothing to the extracted text. Forme ignores an SVG's own
					    alignSelf, so a box places it. */}
					<View style={styles.headerRule.style}>
						<Svg
							viewBox={`0 0 ${HEADER_RULE_VIEW_BOX.width} ${HEADER_RULE_VIEW_BOX.height}`}
							width={HEADER_RULE_WIDTH}
							height={HEADER_RULE_HEIGHT}
							content={styles.headerRule.content}
						/>
					</View>
				</View>
				<View style={styles.headerDetails}>
					{headlineLines.map((line, index) => (
						<Text key={`${index}-${line}`} style={styles.headerHeadline}>
							{line.trim()}
						</Text>
					))}
					<ContactList styles={styles} contacts={contacts} />
					<ContactList styles={styles} contacts={customFields} />
				</View>
			</View>
		</SemanticHeaderView>
	);
};

/** One line of contact items, or nothing when empty. The icons separate the items; a real space keeps them apart in
 * the extracted text. */
const ContactList = ({ styles, contacts }: ContactListProps) => {
	if (contacts.length === 0) return null;

	return (
		<View style={styles.headerContactList}>
			{contacts.map((contact, index) => {
				const itemStyle = composeStyles(
					styles.headerContactItem,
					index === 0 ? styles.headerContactFirstItem : undefined,
				);
				const content = (
					<>
						<PhosphorIcon {...styles.headerContactIcon} name={contact.icon} />
						{/* One run per word, with an untracked space between them: tracking can't eat the space, and
						    extractors still read one. The words sit in a box, as a link would otherwise merge text beside its
						    icon into one run. */}
						<View style={styles.headerContactWords}>
							{contact.text
								.trim()
								.split(/\s+/)
								.map((word, wordIndex) => (
									// oxlint-disable-next-line react/no-array-index-key -- words are positional and never reorder.
									<Fragment key={wordIndex}>
										{wordIndex > 0 && <Text style={styles.headerContactSpace}> </Text>}
										<Text style={styles.headerContact}>{word}</Text>
									</Fragment>
								))}
						</View>
					</>
				);

				return (
					<Fragment key={contact.key}>
						{index > 0 && <Text style={styles.headerContactItemSpace}> </Text>}
						{/* The link covers the whole item, icon and words. */}
						{contact.href ? (
							<Link src={contact.href} style={itemStyle}>
								{content}
							</Link>
						) : (
							<View style={itemStyle}>{content}</View>
						)}
					</Fragment>
				);
			})}
		</View>
	);
};

const SectionRenderer = ({ section, placement, pageNodeKey, mergeLanguages, styles }: SectionRendererProps) => {
	const { sections, customSections } = useRender();
	const customSection = customSections.find((custom) => custom.id === section);
	if (customSection?.type === "skills") {
		return (
			<SkillsSection
				pageNodeKey={pageNodeKey}
				sectionId={section}
				section={customSection as Extract<CustomSection, { type: "skills" }>}
				mergeLanguages={mergeLanguages}
				styles={styles}
			/>
		);
	}

	switch (section) {
		case "summary":
			return <SummarySection pageNodeKey={pageNodeKey} styles={styles} />;
		case "experience":
			return <ExperienceSection pageNodeKey={pageNodeKey} styles={styles} />;
		case "projects":
			return <ProjectsSection pageNodeKey={pageNodeKey} styles={styles} />;
		case "education":
			return <EducationSection pageNodeKey={pageNodeKey} styles={styles} />;
		case "skills":
			return (
				<SkillsSection
					pageNodeKey={pageNodeKey}
					sectionId="skills"
					section={sections.skills}
					mergeLanguages={mergeLanguages}
					styles={styles}
				/>
			);
		case "languages":
			return <LanguagesSection pageNodeKey={pageNodeKey} styles={styles} />;
		case "interests":
			return <InterestsSection pageNodeKey={pageNodeKey} styles={styles} />;
		default:
			return OWN_SECTIONS.has(section) ? null : <Section section={section} placement={placement} />;
	}
};

/**
 * Section box for the sections drawn here: the heading on its own line, then the items. It carries the section's
 * semantic key so the page map still places the section, then clears the key for its items, which are read from the
 * resume data directly.
 */
const OwnSection = ({ sectionId, pageNodeKey, title, styles, children }: OwnSectionProps) => {
	const data = useRender();
	const sectionNodeKey = useSemanticSectionNodeKey(pageNodeKey, sectionId);
	const visible = useSemanticNodeVisible(sectionNodeKey);
	if (!visible) return null;
	// Forme ignores `minPresenceAhead`: the heading and the first item share an unbreakable box instead, so a heading
	// never ends a page on its own.
	const [firstItem, ...otherItems] = Children.toArray(children);

	return (
		<SemanticNodeKeyProvider nodeKey={sectionNodeKey}>
			<View style={styles.ownSection} data-resume-node={sectionNodeKey}>
				<SemanticNodeKeyProvider nodeKey={undefined}>
					<View style={styles.ownItems}>
						<View wrap={false}>
							<Text style={styles.ownSectionHeading}>{getResumeSectionTitle(data, sectionId, title)}</Text>
							{firstItem}
						</View>
						{otherItems}
					</View>
				</SemanticNodeKeyProvider>
			</View>
		</SemanticNodeKeyProvider>
	);
};

/**
 * Bullets with a square drawn as a box, so the extracted text holds no marker glyph. The squares take the bullet
 * colours in turn, carrying on from one list to the next.
 */
const Description = ({ html, bulletKey, styles }: DescriptionProps) => {
	const start = useContext(BulletOffsetsContext).get(bulletKey) ?? 0;
	const blocks = readDescription(html);
	return (
		<View>
			{blocks.map((block, index) => {
				if (block.kind !== "bullet")
					return <Text key={`${index}-${block.text}`}>{renderRuns(block.runs, styles)}</Text>;
				const bulletIndex = start + blocks.slice(0, index).filter((previous) => previous.kind === "bullet").length;
				const backgroundColor = styles.bulletColors[bulletIndex % styles.bulletColors.length];
				return (
					<View key={`${index}-${block.text}`} style={styles.bulletRow}>
						<View style={composeStyles(styles.bulletMarker, backgroundColor ? { backgroundColor } : undefined)} />
						<Text style={styles.bulletContent}>{renderRuns(block.runs, styles)}</Text>
					</View>
				);
			})}
		</View>
	);
};

/** A line's runs inside its own text, bold passages as nested texts so the line still wraps as one. */
const renderRuns = (runs: DescriptionRun[], styles: XatuStyles) =>
	runs.map((run, index) =>
		run.bold ? (
			// oxlint-disable-next-line react/no-array-index-key -- runs are positional and never reorder.
			<Text key={index} style={styles.descriptionBold}>
				{run.text}
			</Text>
		) : (
			run.text
		),
	);

/**
 * One text run: organization (detail) | position | period, so extraction reads the header as a single line. Empty
 * segments drop out with their separator; the detail only takes parentheses after an organization.
 */
const TitleLine = ({ organization, detail, position, period, styles }: TitleLineProps) => {
	const segments: ReactNode[] = [];
	if (hasText(organization)) {
		segments.push(
			<Fragment key="organization">
				<Text style={styles.itemOrganization}>{organization}</Text>
				{hasText(detail) && ` (${detail})`}
			</Fragment>,
		);
	} else if (hasText(detail)) {
		segments.push(detail);
	}
	if (hasText(position)) {
		segments.push(
			<Text key="position" style={styles.itemPosition}>
				{position}
			</Text>,
		);
	}
	if (hasText(period)) segments.push(period);
	if (segments.length === 0) return null;

	return (
		<Text style={styles.itemTitleLine}>
			{segments.map((segment, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- segments are positional and never reorder.
				<Fragment key={index}>
					{index > 0 && " | "}
					{segment}
				</Fragment>
			))}
		</Text>
	);
};

const DatedItem = ({ description, bulletKey, extra, itemNodeKey, styles, ...titleLine }: DatedItemProps) => {
	const itemResolved = useResolvedNode(itemNodeKey);
	const headerResolved = useResolvedNode(itemNodeKey ? semanticNodeKeys.itemHeader(itemNodeKey) : undefined);

	return (
		<View style={composeStyles(styles.ownItem, itemResolved.style)}>
			<View style={composeStyles(styles.itemHeader, headerResolved.style)} minPresenceAhead={30}>
				<TitleLine {...titleLine} styles={styles} />
				{hasText(extra) && <Text style={styles.itemExtra}>{extra}</Text>}
			</View>
			{hasText(description) && <Description html={description} bulletKey={bulletKey} styles={styles} />}
		</View>
	);
};

const LabelledLine = ({ label, values, styles }: LabelledLineProps) => {
	const text = joinText(values, SEPARATOR);

	return (
		<Text style={styles.labelledLine}>
			<Text style={styles.lineLabel}>{label}</Text>
			{hasText(text) && ` : ${text}`}
		</Text>
	);
};

const SummarySection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { summary } = useRender();
	if (summary.hidden || !hasText(summary.content)) return null;

	return (
		<OwnSection sectionId="summary" pageNodeKey={pageNodeKey} title={summary.title} styles={styles}>
			<Description html={summary.content} bulletKey="summary" styles={styles} />
		</OwnSection>
	);
};

const ExperienceSection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { sections } = useRender();
	const sectionNodeKey = useSemanticSectionNodeKey(pageNodeKey, "experience");
	const section = sections.experience;
	const items = experienceItems(section.items);
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="experience" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.flatMap((item) => {
				const itemNodeKey = semanticNodeKeys.item(semanticNodeKeys.sectionItems(sectionNodeKey), item.id);
				const roles = experienceRoles(item);
				const common = { organization: item.company, detail: item.location, styles };
				if (roles.length === 0) {
					return (
						<DatedItem
							key={item.id}
							{...common}
							position={item.position}
							period={item.period}
							description={item.description}
							bulletKey={item.id}
							itemNodeKey={itemNodeKey}
						/>
					);
				}
				// Several roles at one employer: one title line per role, then the employer-wide description.
				return [
					...roles.map((role, index) => (
						<DatedItem
							key={`${item.id}-${role.id}`}
							{...common}
							position={role.position}
							period={role.period}
							description={role.description}
							bulletKey={`${item.id}-${role.id}`}
							itemNodeKey={index === 0 ? itemNodeKey : undefined}
						/>
					)),
					hasText(item.description) && (
						<Description
							key={`${item.id}-description`}
							html={item.description}
							bulletKey={`${item.id}-description`}
							styles={styles}
						/>
					),
				];
			})}
		</OwnSection>
	);
};

const ProjectsSection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { sections } = useRender();
	const section = sections.projects;
	const items = projectItems(section.items);
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="projects" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.map((item) => (
				<DatedItem
					key={item.id}
					organization={item.name}
					period={item.period}
					extra={hasText(item.website.label) ? item.website.label : item.website.url}
					description={item.description}
					bulletKey={item.id}
					styles={styles}
				/>
			))}
		</OwnSection>
	);
};

const EducationSection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { sections } = useRender();
	const section = sections.education;
	const items = educationItems(section.items);
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="education" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.map((item) => (
				<DatedItem
					key={item.id}
					organization={item.school}
					detail={item.location}
					position={joinText([item.degree, item.area], ", ")}
					period={item.period}
					extra={item.grade}
					description={item.description}
					bulletKey={item.id}
					styles={styles}
				/>
			))}
		</OwnSection>
	);
};

const LanguagesLine = ({ styles }: XatuStylesProps) => {
	const data = useRender();
	const section = data.sections.languages;
	const items = section.items.filter((item: LanguageItem) => !item.hidden && hasText(item.language));
	if (section.hidden || items.length === 0) return null;

	return (
		<LabelledLine
			label={getResumeSectionTitle(data, "languages", section.title)}
			values={items.map((item) => (hasText(item.fluency) ? `${item.language} (${item.fluency})` : item.language))}
			styles={styles}
		/>
	);
};

/** Skills, and custom sections of skill items: one line each, the name in bold then keywords or proficiency. */
const SkillsSection = ({ pageNodeKey, sectionId, section, mergeLanguages, styles }: SkillsSectionProps) => {
	const items = section.items.filter((item: SkillItem) => !item.hidden && hasText(item.name));
	if (section.hidden || (items.length === 0 && !mergeLanguages)) return null;

	return (
		<OwnSection sectionId={sectionId} pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{mergeLanguages && <LanguagesLine styles={styles} />}
			{items.map((item) => (
				<LabelledLine
					key={item.id}
					label={item.name}
					values={item.keywords.length > 0 ? item.keywords : [item.proficiency]}
					styles={styles}
				/>
			))}
		</OwnSection>
	);
};

const LanguagesSection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { sections } = useRender();
	const section = sections.languages;
	if (section.hidden || !section.items.some((item) => !item.hidden && hasText(item.language))) return null;

	return (
		<OwnSection sectionId="languages" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			<LanguagesLine styles={styles} />
		</OwnSection>
	);
};

const InterestsSection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { sections } = useRender();
	const section = sections.interests;
	const items = section.items.filter((item: InterestItem) => !item.hidden && hasText(item.name));
	if (section.hidden || items.length === 0) return null;
	const hasKeywords = items.some((item) => item.keywords.some(hasText));

	return (
		<OwnSection sectionId="interests" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{/* Bare names read as one list on a single line; names with keywords keep a line each. */}
			{hasKeywords ? (
				items.map((item) => <LabelledLine key={item.id} label={item.name} values={item.keywords} styles={styles} />)
			) : (
				<Text style={styles.interestsLine}>
					{joinText(
						items.map((item) => item.name),
						SEPARATOR,
					)}
				</Text>
			)}
		</OwnSection>
	);
};

const useXatuTemplate = (): XatuTemplate => {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const accent = primary;
		const colors: TemplateColorRoles = { foreground, background, primary: accent };
		const bodyText = { ...base.text, fontSize: BODY_SIZE, lineHeight: BODY_LINE_HEIGHT };
		const displayFont = [NAME_FONT_FAMILY, metadata.typography.heading.fontFamily];
		const sectionHeading = {
			...base.heading,
			fontFamily: displayFont,
			fontSize: SECTION_HEADING_SIZE,
			fontWeight: "700",
			color: foreground,
			textTransform: "uppercase",
			letterSpacing: 0.8,
			marginBottom: 3,
		} satisfies Style;

		const styles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				fontSize: BODY_SIZE,
				lineHeight: BODY_LINE_HEIGHT,
				paddingVertical: metrics.page.paddingVertical,
				paddingHorizontal: metrics.page.paddingHorizontal,
			},
			text: bodyText,
			small: { ...base.small, fontSize: BODY_SIZE },
			link: { ...base.link, fontSize: BODY_SIZE },
			header: {
				flexDirection: "column",
				marginBottom: HEADER_RULE_GAP_BELOW,
			},
			headerRow: {
				flexDirection: r.row,
				alignItems: "flex-start",
				justifyContent: "space-between",
				paddingTop: HEADER_TOP_OFFSET,
				columnGap: 8,
			},
			headerIdentity: {
				flexDirection: "column",
				flexShrink: 0,
			},
			headerNameSpace: { fontFamily: metadata.typography.heading.fontFamily },
			// As wide as its longest line (the headline), pushed to the far margin by the row; lines start-aligned inside.
			headerDetails: {
				flexDirection: "column",
				alignItems: r.rtl ? "flex-end" : "flex-start",
				rowGap: 2,
				marginTop: HEADER_DETAILS_DROP,
			},
			headerContactList: {
				flexDirection: r.row,
				flexWrap: "wrap",
				justifyContent: "flex-start",
				rowGap: 2,
			},
			headerContactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: 3,
			},
			headerContactWords: { flexDirection: r.row },
			headerContactSpace: {
				width: CONTACT_SPACE_WIDTH,
				flexShrink: 0,
				fontSize: CONTACT_SIZE,
				letterSpacing: 0,
			},
			headerContactFirstItem: { minWidth: CONTACT_FIRST_ITEM_WIDTH },
			headerContactItemSpace: {
				width: CONTACT_ITEM_GAP,
				flexShrink: 0,
				fontSize: CONTACT_SIZE,
				letterSpacing: 0,
			},
			headerName: {
				fontFamily: displayFont,
				fontSize: NAME_SIZE,
				fontWeight: "700",
				lineHeight: 1,
				color: foreground,
			},
			headerHeadline: {
				textAlign: r.rtl ? "right" : "left",
				// Negative tracking still draws the last letter at full width: this keeps it inside the margin it touches.
				...(r.rtl ? { paddingLeft: -HEADER_LETTER_SPACING } : { paddingRight: -HEADER_LETTER_SPACING }),
				fontSize: HEADLINE_SIZE,
				letterSpacing: HEADLINE_LETTER_SPACING,
				lineHeight: 1.25,
				fontWeight: base.bold.fontWeight,
				color: foreground,
			},
			headerContact: {
				fontSize: CONTACT_SIZE,
				letterSpacing: HEADER_LETTER_SPACING,
			},
			body: {
				flexDirection: "column",
				rowGap: SECTION_GAP,
			},
			// Shared renderer slots, for sections this template doesn't draw itself: headers stack instead of splitting.
			section: { flexDirection: "column" },
			sectionHeading,
			sectionHeadingContainer: { flexDirection: "column" },
			sectionItems: { rowGap: metrics.gapY(0.5) },
			item: { rowGap: metrics.gapY(0.125) },
			splitRow: { flexDirection: "column" },
			inlineItemHeader: { flexDirection: "column" },
			sectionItemHeader: { flexDirection: "column" },
			richListItemMarker: { width: BULLET_INDENT, minWidth: BULLET_INDENT, flexShrink: 0, color: foreground },
			levelContainer: { display: "none" },
			ownSection: { flexDirection: "column" },
			ownSectionHeading: sectionHeading,
			ownItems: { rowGap: ITEM_GAP },
			ownItem: { flexDirection: "column" },
			itemHeader: { flexDirection: "column" },
			itemTitleLine: { fontSize: TITLE_LINE_SIZE },
			itemOrganization: { ...base.bold, color: accent },
			itemPosition: base.bold,
			itemExtra: { fontSize: BODY_SIZE },
			labelledLine: { fontSize: BODY_SIZE },
			interestsLine: { fontSize: MIN_SIZE },
			lineLabel: base.bold,
			descriptionBold: base.bold,
			bulletRow: { flexDirection: r.row, alignItems: "flex-start" },
			bulletMarker: {
				width: BULLET_SIZE,
				height: BULLET_SIZE,
				flexShrink: 0,
				marginTop: (BODY_SIZE * BODY_LINE_HEIGHT - BULLET_SIZE) / 2,
				...(r.rtl ? { marginLeft: BULLET_INDENT - BULLET_SIZE } : { marginRight: BULLET_INDENT - BULLET_SIZE }),
				backgroundColor: foreground,
			},
			bulletContent: { flex: 1 },
		});

		return {
			colors,
			styles: {
				...styles,
				icon: { display: "none" },
				sectionHeadingIcon: { display: "none" },
				headerRule: {
					content: HEADER_RULE_SQUARES.map(
						(square) =>
							`<rect x="${square.x}" width="10" height="10" ${square.fill ? `fill="${square.fill}"` : svgFill(accent)} />`,
					).join(""),
					style: {
						flexDirection: "column",
						alignItems: r.rtl ? "flex-end" : "flex-start",
						marginTop: HEADER_RULE_GAP_ABOVE + 1 + HEADER_TOP_OFFSET,
					},
				},
				// One colour for now; more would cycle across every list in reading order.
				bulletColors: [foreground],
				// Contact icons sit beside their text; "Hide icons" in the page settings removes them.
				headerContactIcon: {
					size: CONTACT_SIZE + 1,
					color: foreground,
					display: metadata.page.hideIcons ? "none" : "flex",
				},
			} satisfies XatuStyles,
		};
	}, [metadata, r, primary, metrics, base, foreground, background]);
};

/** SVG fill attributes for a CSS colour: Forme's SVG paint takes hex, so rgba's alpha becomes `fill-opacity`. */
function svgFill(color: string) {
	const parsed = toColor(color) ?? "#000000";
	const match = /^rgba?\(([^)]*)\)$/i.exec(parsed);
	if (!match?.[1]) return `fill="${parsed}"`;
	const [r = 0, g = 0, b = 0, a = 1] = match[1].split(/\s*,\s*/).map(Number);
	const hex = `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
	return a < 1 ? `fill="${hex}" fill-opacity="${a}"` : `fill="${hex}"`;
}
