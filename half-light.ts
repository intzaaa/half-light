import * as R from 'ramda';

type CrossRootStyles = { [key: string]: CSSStyleSheet };
type ShadowRootStylesMap = WeakMap<Element, CSSStyleSheet[]>;

const createCrossRootStyles = (): CrossRootStyles => ({});

const addStyleRule = (
  crossRootStyles: CrossRootStyles,
  selector: string,
  rule: CSSRule
): CrossRootStyles => {
  const updatedStyles = R.clone(crossRootStyles);
  if (!updatedStyles[selector]) {
    updatedStyles[selector] = new CSSStyleSheet();
  }
  updatedStyles[selector].insertRule(rule.cssText);
  return updatedStyles;
};

const isInDarkRoot = (element: HTMLElement): boolean => {
  if (element.parentElement) {
    return isInDarkRoot(element.parentElement);
  } else if (element instanceof ShadowRoot) {
    const host = (element as ShadowRoot).host;
    if (host.hasAttribute('darkened') || (host as any).darkened) {
      return true;
    }
    return isInDarkRoot(host);
  }
  return element !== document.documentElement && !(element instanceof ShadowRoot);
};

const processStyleSheet = (
  rules: CSSRuleList,
  selector: string,
  crossRootStyles: CrossRootStyles
): CrossRootStyles =>
  R.reduce((styles, rule) => addStyleRule(styles, selector, rule), crossRootStyles, [...rules]);

interface MediaQueryResult {
  isCrossRoot: boolean;
  selector: string;
}

const parseMediaQuery = (condition: string): MediaQueryResult => {
  const match = condition.match(/(?:--crossroot\({0,1})([^\)]*)/);
  return {
    isCrossRoot: condition === "--crossroot" || !!match,
    selector: match && match.length === 2 && match[1].trim() ? match[1] : "*"
  };
};

const refreshCrossRootStyles = (styleSheets: CSSStyleSheet[]): CrossRootStyles => {
  return R.reduce((styles, sheet) => {
    if (!(sheet.ownerNode as Element).matches("head > :not([no-half-light])")) return styles;

    const mediaQueryResult = parseMediaQuery(sheet.media.mediaText);
    if (mediaQueryResult.isCrossRoot) {
      styles = processStyleSheet(sheet.cssRules, mediaQueryResult.selector, styles);
    }

    R.forEach((rule) => {
      const ruleType = rule.constructor.name;
      const condition = (rule as CSSMediaRule).conditionText || "";
      const mediaQueryResult = parseMediaQuery(condition);
      if (ruleType === "CSSMediaRule" && mediaQueryResult.isCrossRoot) {
        styles = processStyleSheet((rule as CSSMediaRule).cssRules, mediaQueryResult.selector, styles);
      }
    }, [...sheet.cssRules]);

    return styles;
  }, createCrossRootStyles(), styleSheets);
};

const convertToCSSStyleSheets = (crossRootStyles: CrossRootStyles): CrossRootStyles =>
  R.reduce((styleSheets, selector) => {
    const sheet = new CSSStyleSheet();
    sheet.insertRule(
      "@layer --crossroot {" + (crossRootStyles[selector] as any).cssRules[0].cssText + "}"
    );
    return R.assoc(selector, sheet, styleSheets);
  }, createCrossRootStyles(), R.keys(crossRootStyles));

const clearShadowRootStyles = (element: Element, initialStyleSheets: CSSStyleSheet[]) => {
  element.shadowRoot!.adoptedStyleSheets = initialStyleSheets;
};

const applyCrossRootStyles = (element: Element, crossRootStyles: CrossRootStyles) => {
  R.forEach((selector) => {
    if (element.matches(selector)) {
      element.shadowRoot!.adoptedStyleSheets = [
        ...element.shadowRoot!.adoptedStyleSheets,
        crossRootStyles[selector],
      ];
    }
  }, R.keys(crossRootStyles));
};

const initializeStyles = (
  styleSheets: CSSStyleSheet[],
  stylableElements: Set<Element>,
  initialShadowRootStyles: ShadowRootStylesMap
) => {
  const crossRootStyles = refreshCrossRootStyles(styleSheets);
  const styleSheetMap = convertToCSSStyleSheets(crossRootStyles);
  R.forEach((element) => {
    clearShadowRootStyles(element, initialShadowRootStyles.get(element) || []);
    applyCrossRootStyles(element, styleSheetMap);
  }, Array.from(stylableElements));
};

const observeStyleSheetChanges = (callback: () => void): MutationObserver => {
  const observer = new MutationObserver(callback);
  observer.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  return observer;
};

const handleDOMContentLoaded = (
  script: HTMLScriptElement,
  observer: MutationObserver,
  stylableElements: Set<Element>
) => {
  if (script.hasAttribute('disable-live-half-light')) {
    observer.disconnect();
    stylableElements.clear();
  }
};

const wrapAttachShadow = (
  stylableElements: Set<Element>,
  initialShadowRootStyles: ShadowRootStylesMap,
  liveUpdateEnabled: boolean,
  crossRootStyles: CrossRootStyles
) => {
  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (
    init: ShadowRootInit
  ): ShadowRoot {
    const shadowRoot = originalAttachShadow.call(this, init);
    if (init.mode !== 'open') return shadowRoot;
    requestAnimationFrame(() => {
      if (isInDarkRoot(shadowRoot)) {
        return;
      }
      if (liveUpdateEnabled) {
        stylableElements.add(this);
      }
      initialShadowRootStyles.set(
        this,
        Array.from(shadowRoot.adoptedStyleSheets)
      );
      applyCrossRootStyles(this, crossRootStyles);
    });
    return shadowRoot;
  };
};

const main = () => {
  let crossRootStyles: CrossRootStyles = createCrossRootStyles();
  const stylableElements = new Set<Element>();
  const initialShadowRootStyles: ShadowRootStylesMap = new WeakMap();

  const styleSheets = [...document.styleSheets] as CSSStyleSheet[];
  const initCallback = () => initializeStyles(styleSheets, stylableElements, initialShadowRootStyles);

  requestAnimationFrame(() => {
    initCallback();
    const observer = observeStyleSheetChanges(initCallback);
    const script = document.currentScript as HTMLScriptElement;
    document.addEventListener("DOMContentLoaded", () => {
      handleDOMContentLoaded(script, observer, stylableElements);
    });
  });

  wrapAttachShadow(stylableElements, initialShadowRootStyles, true, crossRootStyles);
};

main();
