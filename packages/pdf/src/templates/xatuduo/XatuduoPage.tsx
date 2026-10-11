import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateStyleSlots } from "../shared/types";
import type {
	EducationItem,
	ExperienceItem,
	InterestItem,
	LanguageItem,
	SkillItem,
} from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { parse } from "node-html-parser";
import { useMemo } from "react";
import { Page, StyleSheet, Text, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
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
import { composeStyles } from "../shared/styles";
import { useTemplateBase } from "../shared/template-base";

// Designed for IBM Plex Sans (400, 500, 600, 700). The font itself comes from `metadata.typography`, the only
// families the renderer downloads; weights below: 700 titles, 600 headline and employers, 400 body.
// Fixed design values, in points (1 mm = 72 / 25.4 pt).
const MM = 72 / 25.4;
const PAGE_PADDING_VERTICAL = 12 * MM;
const PAGE_PADDING_HORIZONTAL = 14 * MM;
const COLUMN_GAP = 20;
const SECTION_GAP = 12;
const ITEM_GAP = 8;
const BULLET_INDENT = 10;

const TEXT_COLOR = "#1B1B1B";
const MUTED_COLOR = "#3A3A3A";
const ACCENT_COLOR = "#1F4E79";
const RULE_COLOR = "#8C8C8C";

const BODY_SIZE = 9.5;
const BODY_LINE_HEIGHT = 1.4;
const SMALL_SIZE = 8.5;

/** Sections this template draws itself; any other section falls back to the shared renderer. */
const OWN_SECTIONS = new Set(["experience", "education", "skills", "languages", "interests"]);

type XatuduoStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	headerName: Style;
	headerHeadline: Style;
	headerContact: Style;
	body: Style;
	mainColumn: Style;
	sidebarColumn: Style;
	ownSection: Style;
	ownSectionHeading: Style;
	ownItems: Style;
	ownItem: Style;
	picture: Style;
	headerTitle: Style;
	itemHeader: Style;
	splitRow: Style;
	itemTitle: Style;
	itemDate: Style;
	itemEmployer: Style;
	sidebarTitle: Style;
	sidebarMuted: Style;
	bulletRow: Style;
	bulletMarker: Style;
	bulletContent: Style;
	bold: Style;
};

type XatuduoTemplate = {
	colors: TemplateColorRoles;
	styles: XatuduoStyles;
};

type XatuduoStylesProps = {
	styles: XatuduoStyles;
};

type OwnSectionProps = XatuduoStylesProps & {
	sectionId: string;
	pageNodeKey: string;
	title: string;
	children: ReactNode;
};

type SectionRendererProps = XatuduoStylesProps & {
	section: string;
	placement: "main" | "sidebar";
	pageNodeKey: string;
};

type ExperienceItemViewProps = XatuduoStylesProps & {
	item: ExperienceItem;
	sectionNodeKey: string;
};

type DescriptionBlock = { kind: "bullet" | "paragraph"; text: string };

type DescriptionProps = XatuduoStylesProps & {
	html: string;
};

const hasText = (value: string) => value.trim().length > 0;

/** Reads a description's list items as bullets and its paragraphs as plain lines; inline markup is dropped. */
const readDescription = (html: string): DescriptionBlock[] =>
	parse(html)
		.querySelectorAll("li, p")
		.map((element): DescriptionBlock => ({
			kind: element.rawTagName.toLowerCase() === "li" ? "bullet" : "paragraph",
			text: element.text.replace(/\s+/g, " ").trim(),
		}))
		.filter((block) => hasText(block.text));

const joinText = (values: string[], separator: string) => values.filter(hasText).join(separator);

export const XatuduoPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { colors, styles } = useXatuduoTemplate();
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));
	const showSidebar = !page.fullWidth && sidebarSections.length > 0;

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				<View style={styles.body}>
					{/* The main column comes first in the document, so text extraction reads it before the sidebar. */}
					<SemanticRegionView region="main" style={styles.mainColumn}>
						{mainSections.map((section) => (
							<SectionRenderer
								key={section}
								section={section}
								placement="main"
								pageNodeKey={pageNodeKey}
								styles={styles}
							/>
						))}
					</SemanticRegionView>

					{showSidebar && (
						<SemanticRegionView region="sidebar" style={styles.sidebarColumn}>
							{sidebarSections.map((section) => (
								<SectionRenderer
									key={section}
									section={section}
									placement="sidebar"
									pageNodeKey={pageNodeKey}
									styles={styles}
								/>
							))}
						</SemanticRegionView>
					)}
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: XatuduoStylesProps) => {
	const { basics, picture } = useRender();
	const contact = joinText(
		[basics.phone, basics.email, basics.location, ...basics.customFields.map((field) => field.text)],
		" · ",
	);

	return (
		<SemanticHeaderView style={styles.header}>
			{hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
			<View style={styles.headerTitle}>
				<Text style={styles.headerName}>{basics.name}</Text>
				{hasText(basics.headline) && <Text style={styles.headerHeadline}>{basics.headline}</Text>}
				{hasText(contact) && <Text style={styles.headerContact}>{contact}</Text>}
			</View>
		</SemanticHeaderView>
	);
};

const SectionRenderer = ({ section, placement, pageNodeKey, styles }: SectionRendererProps) => {
	switch (section) {
		case "experience":
			return <ExperienceSection pageNodeKey={pageNodeKey} styles={styles} />;
		case "education":
			return <EducationSection pageNodeKey={pageNodeKey} styles={styles} />;
		case "skills":
			return <SkillsSection pageNodeKey={pageNodeKey} styles={styles} />;
		case "languages":
			return <LanguagesSection pageNodeKey={pageNodeKey} styles={styles} />;
		case "interests":
			return <InterestsSection pageNodeKey={pageNodeKey} styles={styles} />;
		default:
			return OWN_SECTIONS.has(section) ? null : <Section section={section} placement={placement} />;
	}
};

/**
 * Section box for the sections drawn here. It carries the section's semantic key so the page map still places the
 * section, then clears the key for its items: those are read from the resume data directly, which keeps entries the
 * shared filter treats as drafts (an experience without an employer).
 */
const OwnSection = ({ sectionId, pageNodeKey, title, styles, children }: OwnSectionProps) => {
	const data = useRender();
	const sectionNodeKey = useSemanticSectionNodeKey(pageNodeKey, sectionId);
	const visible = useSemanticNodeVisible(sectionNodeKey);
	if (!visible) return null;

	return (
		<SemanticNodeKeyProvider nodeKey={sectionNodeKey}>
			<View style={styles.ownSection} data-resume-node={sectionNodeKey}>
				<Text style={styles.ownSectionHeading}>{getResumeSectionTitle(data, sectionId, title)}</Text>
				<SemanticNodeKeyProvider nodeKey={undefined}>
					<View style={styles.ownItems}>{children}</View>
				</SemanticNodeKeyProvider>
			</View>
		</SemanticNodeKeyProvider>
	);
};

const Description = ({ html, styles }: DescriptionProps) => (
	<View>
		{readDescription(html).map((block, index) =>
			block.kind === "bullet" ? (
				<View key={`${index}-${block.text}`} style={styles.bulletRow}>
					<Text style={styles.bulletMarker}>•</Text>
					<Text style={styles.bulletContent}>{block.text}</Text>
				</View>
			) : (
				<Text key={`${index}-${block.text}`}>{block.text}</Text>
			),
		)}
	</View>
);

const ExperienceSection = ({ pageNodeKey, styles }: Omit<SectionRendererProps, "section" | "placement">) => {
	const { sections } = useRender();
	const sectionNodeKey = useSemanticSectionNodeKey(pageNodeKey, "experience");
	const section = sections.experience;
	const items = section.items.filter(
		(item: ExperienceItem) => !item.hidden && (hasText(item.position) || hasText(item.company)),
	);
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="experience" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.map((item) => (
				<ExperienceItemView key={item.id} item={item} sectionNodeKey={sectionNodeKey} styles={styles} />
			))}
		</OwnSection>
	);
};

/**
 * One position: title and dates, then employer and location, then the bullets. Items the shared filter keeps also
 * take the semantic stylesheet's `item` and `item-header` styles; the others (no employer) have no semantic node.
 */
const ExperienceItemView = ({ item, sectionNodeKey, styles }: ExperienceItemViewProps) => {
	const itemNodeKey = semanticNodeKeys.item(semanticNodeKeys.sectionItems(sectionNodeKey), item.id);
	const itemResolved = useResolvedNode(itemNodeKey);
	const headerResolved = useResolvedNode(semanticNodeKeys.itemHeader(itemNodeKey));
	const title = hasText(item.position) ? item.position : item.company;
	const employer = joinText([hasText(item.position) ? item.company : "", item.location], ", ");

	return (
		<View style={composeStyles(styles.ownItem, itemResolved.style)} wrap={false}>
			<View style={composeStyles(styles.itemHeader, headerResolved.style)}>
				<View style={styles.splitRow}>
					<Text style={styles.itemTitle}>{title}</Text>
					{hasText(item.period) && <Text style={styles.itemDate}>{item.period}</Text>}
				</View>
				{hasText(employer) && <Text style={styles.itemEmployer}>{employer}</Text>}
			</View>
			{hasText(item.description) && <Description html={item.description} styles={styles} />}
		</View>
	);
};

const EducationSection = ({ pageNodeKey, styles }: Omit<SectionRendererProps, "section" | "placement">) => {
	const { sections } = useRender();
	const section = sections.education;
	const items = section.items.filter(
		(item: EducationItem) => !item.hidden && (hasText(item.school) || hasText(item.degree)),
	);
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="education" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.map((item) => {
				const details = joinText([item.location, item.period], " · ");

				return (
					<View key={item.id} wrap={false}>
						<Text style={styles.sidebarTitle}>{joinText([item.degree, item.school], ", ")}</Text>
						{hasText(item.area) && <Text>{item.area}</Text>}
						{hasText(details) && <Text style={styles.sidebarMuted}>{details}</Text>}
					</View>
				);
			})}
		</OwnSection>
	);
};

const SkillsSection = ({ pageNodeKey, styles }: Omit<SectionRendererProps, "section" | "placement">) => {
	const { sections } = useRender();
	const section = sections.skills;
	const items = section.items.filter((item: SkillItem) => !item.hidden && hasText(item.name));
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="skills" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.map((item) => (
				<View key={item.id} wrap={false}>
					<Text style={styles.sidebarTitle}>{item.name}</Text>
					{item.keywords.length > 0 ? (
						<Text>{joinText(item.keywords, ", ")}</Text>
					) : (
						hasText(item.proficiency) && <Text>{item.proficiency}</Text>
					)}
				</View>
			))}
		</OwnSection>
	);
};

const LanguagesSection = ({ pageNodeKey, styles }: Omit<SectionRendererProps, "section" | "placement">) => {
	const { sections } = useRender();
	const section = sections.languages;
	const items = section.items.filter((item: LanguageItem) => !item.hidden && hasText(item.language));
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="languages" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.map((item) => (
				<Text key={item.id}>
					<Text style={styles.bold}>{item.language}</Text>
					{hasText(item.fluency) ? ` : ${item.fluency}` : ""}
				</Text>
			))}
		</OwnSection>
	);
};

const InterestsSection = ({ pageNodeKey, styles }: Omit<SectionRendererProps, "section" | "placement">) => {
	const { sections } = useRender();
	const section = sections.interests;
	const items = section.items.filter((item: InterestItem) => !item.hidden && hasText(item.name));
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="interests" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.map((item) => (
				<Text key={item.id}>{joinText([item.name, item.keywords.join(", ")], " : ")}</Text>
			))}
		</OwnSection>
	);
};

const useXatuduoTemplate = (): XatuduoTemplate => {
	const { metadata, r, background, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const colors: TemplateColorRoles = { foreground: TEXT_COLOR, background, primary: TEXT_COLOR };
		const fontFamily = metadata.typography.body.fontFamily;
		const bodyText = { fontFamily, fontSize: BODY_SIZE, lineHeight: BODY_LINE_HEIGHT, color: TEXT_COLOR };
		const sectionHeading = {
			fontFamily,
			fontSize: 9,
			fontWeight: "700",
			lineHeight: 1.2,
			letterSpacing: 9 * 0.08,
			textTransform: "uppercase",
			color: TEXT_COLOR,
			borderBottomWidth: 0.5,
			borderBottomColor: RULE_COLOR,
			paddingBottom: 2,
			marginBottom: 5,
		} satisfies Style;

		const styles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				...bodyText,
				paddingTop: PAGE_PADDING_VERTICAL,
				paddingBottom: PAGE_PADDING_VERTICAL,
				paddingHorizontal: PAGE_PADDING_HORIZONTAL,
			},
			text: { ...base.text, ...bodyText },
			heading: { ...base.heading, fontFamily, color: TEXT_COLOR },
			bold: { fontWeight: "700" },
			link: { ...base.link, color: TEXT_COLOR },
			header: {
				borderBottomWidth: 0.75,
				borderBottomColor: TEXT_COLOR,
				paddingBottom: 8,
				marginBottom: 14,
				flexDirection: r.row,
				alignItems: "center",
				columnGap: 12,
			},
			headerTitle: {
				flex: 1,
				rowGap: 3,
			},
			headerName: {
				fontSize: 21,
				fontWeight: "700",
				lineHeight: 1.15,
				letterSpacing: 0.8,
				textTransform: "uppercase",
			},
			headerHeadline: {
				fontSize: 11,
				fontWeight: "600",
				color: ACCENT_COLOR,
			},
			headerContact: {
				fontSize: SMALL_SIZE,
				color: MUTED_COLOR,
			},
			body: {
				flexDirection: r.columns,
				columnGap: COLUMN_GAP,
			},
			mainColumn: {
				flexGrow: 2,
				flexShrink: 1,
				flexBasis: 0,
				rowGap: SECTION_GAP,
			},
			sidebarColumn: {
				flexGrow: 1,
				flexShrink: 1,
				flexBasis: 0,
				rowGap: SECTION_GAP,
			},
			// Shared renderer slots, for sections this template doesn't draw itself.
			section: { flexDirection: "column" },
			sectionHeading,
			sectionItems: { rowGap: ITEM_GAP },
			item: { rowGap: metrics.gapY(0.125) },
			ownSection: { flexDirection: "column" },
			ownSectionHeading: sectionHeading,
			ownItems: { rowGap: ITEM_GAP },
			ownItem: { flexDirection: "column" },
			itemHeader: { flexDirection: "column" },
			splitRow: {
				flexDirection: r.row,
				justifyContent: "space-between",
				alignItems: "baseline",
				columnGap: 8,
			},
			itemTitle: {
				flexShrink: 1,
				fontSize: 10,
				fontWeight: "700",
			},
			itemDate: {
				flexShrink: 0,
				fontSize: SMALL_SIZE,
				color: MUTED_COLOR,
			},
			itemEmployer: {
				fontWeight: "600",
				color: ACCENT_COLOR,
			},
			sidebarTitle: { fontWeight: "700" },
			sidebarMuted: { color: MUTED_COLOR },
			bulletRow: { flexDirection: r.row },
			bulletMarker: { width: BULLET_INDENT, flexShrink: 0 },
			bulletContent: { flex: 1 },
			richListItemMarker: { width: BULLET_INDENT, minWidth: BULLET_INDENT, flexShrink: 0, textAlign: "left" },
			levelContainer: { display: "none" },
		});

		return {
			colors,
			styles: {
				...styles,
				icon: { display: "none" },
				sectionHeadingIcon: { display: "none" },
			} satisfies XatuduoStyles,
		};
	}, [metadata, r, background, metrics, base]);
};
