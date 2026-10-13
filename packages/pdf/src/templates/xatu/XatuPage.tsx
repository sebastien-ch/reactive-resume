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
import type { HTMLElement } from "node-html-parser";
import type { ReactNode } from "react";
import { parse } from "node-html-parser";
import { Fragment, useMemo } from "react";
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

// Strictly one column: every section, main then sidebar, is stacked in one reading order. The only row in the page is
// a bullet and its text. The name takes the heading font (meant for Hanken Grotesk), the rest the body font.
// Type scale in PDF points (the source mockup's 12 px is 9 pt). 9 pt is kept for the header contact line and the
// keyword-less interests line.
const HEADER_TEXT_COLOR = "#FFFFFF";
const MIN_SIZE = 9;
const BODY_SIZE = 10;
const BODY_LINE_HEIGHT = 1.3;
const TITLE_LINE_SIZE = 10.5;
const SECTION_HEADING_SIZE = 10;
const HEADLINE_SIZE = 11;
const NAME_SIZE = 24;
const SEPARATOR = " · ";
const BULLET_SIZE = 4;
const BULLET_INDENT = 12;

/** Sections this template draws itself; any other section falls back to the shared renderer. */
const OWN_SECTIONS = new Set(["summary", "experience", "projects", "education", "skills", "languages", "interests"]);

type XatuStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerName: Style;
	headerHeadline: Style;
	headerContact: Style;
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
	bulletRow: Style;
	bulletMarker: Style;
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
	extra?: string | undefined;
	itemNodeKey?: string | undefined;
};

type LabelledLineProps = XatuStylesProps & {
	label: string;
	values: string[];
};

type DescriptionBlock = { kind: "bullet" | "paragraph"; text: string };

type DescriptionProps = XatuStylesProps & {
	html: string;
};

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

const joinText = (values: (string | undefined)[], separator: string) => values.filter(hasText).join(separator);

const isInsideListItem = (element: HTMLElement) => {
	for (let parent = element.parentNode; parent; parent = parent.parentNode) {
		if (parent.rawTagName?.toLowerCase() === "li") return true;
	}
	return false;
};

/** Reads a description's list items as bullets and its paragraphs as plain lines; inline markup is dropped. */
const readDescription = (html: string): DescriptionBlock[] =>
	parse(html)
		.querySelectorAll("li, p")
		.filter((element) => element.rawTagName.toLowerCase() === "li" || !isInsideListItem(element))
		.map((element): DescriptionBlock => ({
			kind: element.rawTagName.toLowerCase() === "li" ? "bullet" : "paragraph",
			text: element.text.replace(/\s+/g, " ").trim(),
		}))
		.filter((block) => hasText(block.text));

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

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
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
		</Page>
	);
};

const Header = ({ styles }: XatuStylesProps) => {
	const { basics, picture } = useRender();
	const website = hasText(basics.website.label) ? basics.website.label : basics.website.url;
	const contact = joinText(
		[basics.phone, basics.email, basics.location, website, ...basics.customFields.map((field) => field.text)],
		SEPARATOR,
	);
	const headlineLines = basics.headline.split(/\r?\n/).filter(hasText);

	return (
		<SemanticHeaderView style={styles.header}>
			{/* Stacked above the name, never beside it, so the band stays one column. */}
			{hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
			<Text style={styles.headerName}>{basics.name}</Text>
			{headlineLines.map((line, index) => (
				<Text key={`${index}-${line}`} style={styles.headerHeadline}>
					{line.trim()}
				</Text>
			))}
			{hasText(contact) && <Text style={styles.headerContact}>{contact}</Text>}
		</SemanticHeaderView>
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

	return (
		<SemanticNodeKeyProvider nodeKey={sectionNodeKey}>
			<View style={styles.ownSection} data-resume-node={sectionNodeKey}>
				<Text style={styles.ownSectionHeading} minPresenceAhead={40}>
					{getResumeSectionTitle(data, sectionId, title)}
				</Text>
				<SemanticNodeKeyProvider nodeKey={undefined}>
					<View style={styles.ownItems}>{children}</View>
				</SemanticNodeKeyProvider>
			</View>
		</SemanticNodeKeyProvider>
	);
};

/** Bullets with an accent square drawn as a box, so the extracted text holds no marker glyph. */
const Description = ({ html, styles }: DescriptionProps) => (
	<View>
		{readDescription(html).map((block, index) =>
			block.kind === "bullet" ? (
				<View key={`${index}-${block.text}`} style={styles.bulletRow}>
					<View style={styles.bulletMarker} />
					<Text style={styles.bulletContent}>{block.text}</Text>
				</View>
			) : (
				<Text key={`${index}-${block.text}`}>{block.text}</Text>
			),
		)}
	</View>
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

const DatedItem = ({ description, extra, itemNodeKey, styles, ...titleLine }: DatedItemProps) => {
	const itemResolved = useResolvedNode(itemNodeKey);
	const headerResolved = useResolvedNode(itemNodeKey ? semanticNodeKeys.itemHeader(itemNodeKey) : undefined);

	return (
		<View style={composeStyles(styles.ownItem, itemResolved.style)}>
			<View style={composeStyles(styles.itemHeader, headerResolved.style)} minPresenceAhead={30}>
				<TitleLine {...titleLine} styles={styles} />
				{hasText(extra) && <Text style={styles.itemExtra}>{extra}</Text>}
			</View>
			{hasText(description) && <Description html={description} styles={styles} />}
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
			<Description html={summary.content} styles={styles} />
		</OwnSection>
	);
};

const ExperienceSection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { sections } = useRender();
	const sectionNodeKey = useSemanticSectionNodeKey(pageNodeKey, "experience");
	const section = sections.experience;
	const items = section.items.filter(
		(item: ExperienceItem) => !item.hidden && (hasText(item.position) || hasText(item.company)),
	);
	if (section.hidden || items.length === 0) return null;

	return (
		<OwnSection sectionId="experience" pageNodeKey={pageNodeKey} title={section.title} styles={styles}>
			{items.flatMap((item) => {
				const itemNodeKey = semanticNodeKeys.item(semanticNodeKeys.sectionItems(sectionNodeKey), item.id);
				const roles = item.roles.filter((role) => hasText(role.position) || hasText(role.period));
				const common = { organization: item.company, detail: item.location, styles };
				if (roles.length === 0) {
					return (
						<DatedItem
							key={item.id}
							{...common}
							position={item.position}
							period={item.period}
							description={item.description}
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
							itemNodeKey={index === 0 ? itemNodeKey : undefined}
						/>
					)),
					hasText(item.description) && (
						<Description key={`${item.id}-description`} html={item.description} styles={styles} />
					),
				];
			})}
		</OwnSection>
	);
};

const ProjectsSection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { sections } = useRender();
	const section = sections.projects;
	const items = section.items.filter((item: ProjectItem) => !item.hidden && hasText(item.name));
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
					styles={styles}
				/>
			))}
		</OwnSection>
	);
};

const EducationSection = ({ pageNodeKey, styles }: SectionBaseProps) => {
	const { sections } = useRender();
	const section = sections.education;
	const items = section.items.filter(
		(item: EducationItem) => !item.hidden && (hasText(item.school) || hasText(item.degree)),
	);
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
		const sectionHeading = {
			...base.heading,
			fontSize: SECTION_HEADING_SIZE,
			color: accent,
			textTransform: "uppercase",
			letterSpacing: 0.8,
			borderBottomWidth: 0.75,
			borderBottomColor: accent,
			paddingBottom: 2,
			marginBottom: metrics.gapY(0.5),
		} satisfies Style;

		const styles = StyleSheet.create({
			...base,
			// No horizontal page padding: the header band runs edge to edge, the body sets its own margins.
			page: {
				...base.page,
				fontSize: BODY_SIZE,
				lineHeight: BODY_LINE_HEIGHT,
				paddingVertical: metrics.page.paddingVertical,
			},
			text: bodyText,
			small: { ...base.small, fontSize: BODY_SIZE },
			link: { ...base.link, fontSize: BODY_SIZE },
			header: {
				flexDirection: "column",
				marginTop: -metrics.page.paddingVertical,
				marginBottom: metrics.sectionGap,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				rowGap: metrics.gapY(0.25),
				backgroundColor: accent,
				color: HEADER_TEXT_COLOR,
			},
			headerName: {
				fontFamily: metadata.typography.heading.fontFamily,
				fontSize: NAME_SIZE,
				fontWeight: "700",
				lineHeight: 1.1,
				color: HEADER_TEXT_COLOR,
			},
			headerHeadline: {
				fontSize: HEADLINE_SIZE,
				lineHeight: 1.25,
				color: HEADER_TEXT_COLOR,
			},
			headerContact: {
				fontSize: MIN_SIZE,
				marginTop: metrics.gapY(0.25),
				color: HEADER_TEXT_COLOR,
			},
			body: {
				flexDirection: "column",
				paddingHorizontal: metrics.page.paddingHorizontal,
				rowGap: metrics.sectionGap,
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
			richListItemMarker: { width: BULLET_INDENT, minWidth: BULLET_INDENT, flexShrink: 0, color: accent },
			levelContainer: { display: "none" },
			ownSection: { flexDirection: "column" },
			ownSectionHeading: sectionHeading,
			ownItems: { rowGap: metrics.gapY(0.5) },
			ownItem: { flexDirection: "column" },
			itemHeader: { flexDirection: "column" },
			itemTitleLine: { fontSize: TITLE_LINE_SIZE },
			itemOrganization: { ...base.bold, color: accent },
			itemPosition: base.bold,
			itemExtra: { fontSize: BODY_SIZE },
			labelledLine: { fontSize: BODY_SIZE },
			interestsLine: { fontSize: MIN_SIZE },
			lineLabel: base.bold,
			bulletRow: { flexDirection: r.row, alignItems: "flex-start" },
			bulletMarker: {
				width: BULLET_SIZE,
				height: BULLET_SIZE,
				flexShrink: 0,
				marginTop: (BODY_SIZE * BODY_LINE_HEIGHT - BULLET_SIZE) / 2,
				...(r.rtl ? { marginLeft: BULLET_INDENT - BULLET_SIZE } : { marginRight: BULLET_INDENT - BULLET_SIZE }),
				backgroundColor: accent,
			},
			bulletContent: { flex: 1 },
		});

		return {
			colors,
			styles: {
				...styles,
				icon: { display: "none" },
				sectionHeadingIcon: { display: "none" },
			} satisfies XatuStyles,
		};
	}, [metadata, r, primary, metrics, base, foreground, background]);
};
