import {
  KioskModeRunner,
  HomeAssistant,
  User,
  Lovelace,
  KioskConfig,
  ConditionalKioskConfig,
  SuscriberEvent
} from '@types';
import {
  CACHE,
  OPTION,
  ELEMENT,
  TRUE,
  FALSE,
  BOOLEAN,
  CUSTOM_MOBILE_WIDTH_DEFAULT,
  SUSCRIBE_EVENTS_TYPE,
  STATE_CHANGED_EVENT,
  WINDOW_RESIZE_DELAY,
  NAMESPACE,
  NON_CRITICAL_WARNING,
  SHADOW_ROOT_SUFFIX
} from '@constants';
import {
  toArray,
  queryString,
  setCache,
  cached,
  addStyle,
  removeStyle,
  getMenuTranslations,
  getPromisableElement
} from '@utilities';
import { STYLES } from '@styles';

import { ConInfo } from './conf-info';

class KioskMode implements KioskModeRunner {
  constructor() {
    window.kioskModeEntities = {};
    if (queryString(OPTION.CLEAR_CACHE)) {
      setCache([
        CACHE.HEADER,
        CACHE.SIDEBAR,
        CACHE.OVERFLOW,
        CACHE.MENU_BUTTON,
        CACHE.ACCOUNT,
        CACHE.SEARCH,
        CACHE.ASSISTANT,
        CACHE.REFRESH,
        CACHE.UNUSED_ENTITIES,
        CACHE.RELOAD_RESOURCES,
        CACHE.EDIT_DASHBOARD,
        CACHE.DIALOG_HEADER_HISTORY,
        CACHE.DIALOG_HEADER_SETTINGS,
        CACHE.DIALOG_HEADER_OVERFLOW,
        CACHE.DIALOG_HISTORY,
        CACHE.DIALOG_LOGBOOK,
        CACHE.DIALOG_ATTRIBUTES,
        CACHE.DIALOG_HISTORY_SHOW_MORE,
        CACHE.DIALOG_LOGBOOK_SHOW_MORE,
        CACHE.OVERFLOW_MOUSE,
        CACHE.MOUSE
      ], FALSE);
    }

    const selectMainElements = async () => {

      // Select ha
      this.ha = await getPromisableElement(
        (): HomeAssistant => document.querySelector<HomeAssistant>(ELEMENT.HOME_ASSISTANT),
        (ha: HomeAssistant) => !!(ha && ha.shadowRoot),
        ELEMENT.HOME_ASSISTANT
      );

      // Select home assistant main
      this.main = await getPromisableElement(
        (): ShadowRoot => this.ha.shadowRoot.querySelector(ELEMENT.HOME_ASSISTANT_MAIN)?.shadowRoot,
        (main: ShadowRoot) => !!main,
        `${ELEMENT.HOME_ASSISTANT_MAIN}${SHADOW_ROOT_SUFFIX}`
      );

      // Select user
      this.user = await getPromisableElement(
        (): User => this.ha?.hass?.user,
        (user: User) => !!user,
        `${ELEMENT.HOME_ASSISTANT} > hass > user`
      );

      // Select partial panel resolver
      const partialPanelResolver = await getPromisableElement(
        (): Element => this.main.querySelector(ELEMENT.PARTIAL_PANEL_RESOLVER),
        (partialPanelResolver: Element) => !!partialPanelResolver,
        `${ELEMENT.HOME_ASSISTANT_MAIN} > ${ELEMENT.PARTIAL_PANEL_RESOLVER}`
      );

      // Start kiosk-mode
      this.run();
      this.entityWatch();

      // Start the mutation observer for partial panel resolver
      new MutationObserver(this.watchDashboards).observe(partialPanelResolver, {
        childList: true,
      });

      // Start the mutation observer for more info dialog
      new MutationObserver(this.watchMoreInfoDialogs).observe(this.ha.shadowRoot, {
        childList: true,
      });

    };

    selectMainElements();

    this.resizeWindowBinded = this.resizeWindow.bind(this);   
    
  }

  // Elements
  private ha: HomeAssistant;
  private main: ShadowRoot;
  private user: User;
  private huiRoot: ShadowRoot;
  private lovelace: Lovelace;
  private drawerLayout: HTMLElement;
  private appToolbar: HTMLElement;
  private sideBarRoot: ShadowRoot;
  private menuTranslations: Record<string, string>;
  private resizeDelay: number;
  private resizeWindowBinded: () => void;

  // Kiosk Mode options
  private hideHeader: boolean;
  private hideSidebar: boolean;
  private hideOverflow: boolean;
  private hideMenuButton: boolean;
  private hideAccount: boolean;
  private hideSearch: boolean;
  private hideAssistant: boolean;
  private hideRefresh: boolean;
  private hideUnusedEntities: boolean;
  private hideReloadResources: boolean;
  private hideEditDashboard: boolean;
  private hideDialogHeaderHistory: boolean;
  private hideDialogHeaderSettings: boolean;
  private hideDialogHeaderOverflow: boolean;
  private hideDialogHistory: boolean;
  private hideDialogLogbook: boolean;
  private hideDialogAttributes: boolean;
  private hideDialogHistoryShowMore: boolean;
  private hideDialogLogbookShowMore: boolean;
  private blockOverflow: boolean;
  private blockMouse: boolean;
  private ignoreEntity: boolean;
  private ignoreMobile: boolean;
  private ignoreDisableKm: boolean;

  public run(lovelace = this.main.querySelector<Lovelace>(ELEMENT.HA_PANEL_LOVELACE)) {
    if (!lovelace) {
      return;
    }
    this.lovelace = lovelace;

    // Get the configuration and process it
    getPromisableElement(
      () => lovelace?.lovelace?.config,
      (config: Lovelace['lovelace']['config']) => !!config,
      'Lovelace config'
    )
      .then((config: Lovelace['lovelace']['config']) => {
        this.processConfig(
          config.kiosk_mode || {}
        );
      });
  }

  public async runDialogs(moreInfoDialog: Element) {

    const moreInfoDialogShadowRoot = await getPromisableElement(
      () => moreInfoDialog?.shadowRoot,
      (shadowRoot: ShadowRoot) => !!shadowRoot,
      `${ELEMENT.HA_MORE_INFO_DIALOG}:${SHADOW_ROOT_SUFFIX}`
    );

    const dialog = await getPromisableElement(
      () => moreInfoDialogShadowRoot.querySelector<HTMLElement>(ELEMENT.HA_DIALOG),
      (dialog: HTMLElement) => !!dialog,
      `${ELEMENT.HA_MORE_INFO_DIALOG}:${SHADOW_ROOT_SUFFIX} > ${ELEMENT.HA_DIALOG}`
    );

    this.insertDialogStyles(dialog);

  }

  protected async processConfig(config: KioskConfig) {
    const dash = this.ha.hass.panelUrl;
    if (!window.kioskModeEntities[dash]) {
      window.kioskModeEntities[dash] = [];
    }
    this.hideHeader                = false;
    this.hideSidebar               = false;
    this.hideOverflow              = false;
    this.hideMenuButton            = false;
    this.hideAccount               = false;
    this.hideSearch                = false;
    this.hideAssistant             = false;
    this.hideRefresh               = false;
    this.hideUnusedEntities        = false;
    this.hideReloadResources       = false;
    this.hideEditDashboard         = false;
    this.hideDialogHeaderHistory   = false;
    this.hideDialogHeaderSettings  = false;
    this.hideDialogHeaderOverflow  = false;
    this.hideDialogHistory         = false;
    this.hideDialogLogbook         = false;
    this.hideDialogAttributes      = false;
    this.hideDialogHistoryShowMore = false;
    this.hideDialogLogbookShowMore = false;
    this.blockOverflow             = false;
    this.blockMouse                = false;
    this.ignoreEntity              = false;
    this.ignoreMobile              = false;
    this.ignoreDisableKm           = false;

    this.huiRoot = await getPromisableElement(
      (): ShadowRoot => this.lovelace?.shadowRoot?.querySelector(ELEMENT.HUI_ROOT)?.shadowRoot,
      (huiRoot: ShadowRoot) => !!huiRoot,
      `${ELEMENT.HUI_ROOT}${SHADOW_ROOT_SUFFIX}`
    );
    
    this.drawerLayout = await getPromisableElement(
      (): HTMLElement => this.main.querySelector<HTMLElement>(ELEMENT.HA_DRAWER),
      (drawerLayout: HTMLElement) => !!drawerLayout,
      ELEMENT.HA_DRAWER
    );
    
    this.appToolbar = await getPromisableElement(
      (): HTMLElement => this.huiRoot.querySelector<HTMLElement>(ELEMENT.TOOLBAR),
      (appToolbar: HTMLElement) => !!appToolbar,
      ELEMENT.TOOLBAR
    );

    this.sideBarRoot = await getPromisableElement(
      (): ShadowRoot => this.drawerLayout.querySelector(ELEMENT.HA_SIDEBAR)?.shadowRoot,
      (sideBarRoot: ShadowRoot) => !!sideBarRoot,
      `${ELEMENT.HA_SIDEBAR}${SHADOW_ROOT_SUFFIX}`
    );

    // Get menu translations
    getMenuTranslations(this.ha)
      .then((menuTranslations: Record<string, string>) => {
        this.menuTranslations = menuTranslations;
        this.updateMenuItemsLabels();
      })
      .catch(() => {
        console.warn(`${NAMESPACE}: ${NON_CRITICAL_WARNING} Cannot get resources translations`);
      });

    // Retrieve localStorage values & query string options.
    const queryStringsSet = (
      cached([
        CACHE.HEADER,
        CACHE.SIDEBAR,
        CACHE.OVERFLOW,
        CACHE.MENU_BUTTON,
        CACHE.ACCOUNT,
        CACHE.SEARCH,
        CACHE.ASSISTANT,
        CACHE.REFRESH,
        CACHE.UNUSED_ENTITIES,
        CACHE.RELOAD_RESOURCES,
        CACHE.EDIT_DASHBOARD,
        CACHE.DIALOG_HEADER_HISTORY,
        CACHE.DIALOG_HEADER_SETTINGS,
        CACHE.DIALOG_HEADER_OVERFLOW,
        CACHE.DIALOG_HISTORY,
        CACHE.DIALOG_LOGBOOK,
        CACHE.DIALOG_ATTRIBUTES,
        CACHE.DIALOG_HISTORY_SHOW_MORE,
        CACHE.DIALOG_LOGBOOK_SHOW_MORE,
        CACHE.OVERFLOW_MOUSE,
        CACHE.MOUSE
      ]) ||
      queryString([
        OPTION.KIOSK,
        OPTION.HIDE_HEADER,
        OPTION.HIDE_SIDEBAR,
        OPTION.HIDE_OVERFLOW,
        OPTION.HIDE_MENU_BUTTON,
        OPTION.HIDE_ACCOUNT,
        OPTION.HIDE_SEARCH,
        OPTION.HIDE_ASSISTANT,
        OPTION.HIDE_REFRESH,
        OPTION.HIDE_RELOAD_RESOURCES,
        OPTION.HIDE_UNUSED_ENTITIES,
        OPTION.HIDE_EDIT_DASHBOARD,
        OPTION.HIDE_DIALOG_HEADER_HISTORY,
        OPTION.HIDE_DIALOG_HEADER_SETTINGS,
        OPTION.HIDE_DIALOG_HEADER_OVERFLOW,
        OPTION.HIDE_DIALOG_HISTORY,
        OPTION.HIDE_DIALOG_LOGBOOK,
        OPTION.HIDE_DIALOG_ATTRIBUTES,
        OPTION.HIDE_DIALOG_HISTORY_SHOW_MORE,
        OPTION.HIDE_DIALOG_LOGBOOK_SHOW_MORE,
        OPTION.BLOCK_OVERFLOW,
        OPTION.BLOCK_MOUSE
      ])
    );
    if (queryStringsSet) {
      this.hideHeader                = cached(CACHE.HEADER)                   || queryString([OPTION.KIOSK, OPTION.HIDE_HEADER]);
      this.hideSidebar               = cached(CACHE.SIDEBAR)                  || queryString([OPTION.KIOSK, OPTION.HIDE_SIDEBAR]);
      this.hideOverflow              = cached(CACHE.OVERFLOW)                 || queryString([OPTION.HIDE_OVERFLOW]);
      this.hideMenuButton            = cached(CACHE.MENU_BUTTON)              || queryString([OPTION.HIDE_MENU_BUTTON]);
      this.hideAccount               = cached(CACHE.ACCOUNT)                  || queryString([OPTION.HIDE_ACCOUNT]);
      this.hideSearch                = cached(CACHE.SEARCH)                   || queryString([OPTION.HIDE_SEARCH]);
      this.hideAssistant             = cached(CACHE.ASSISTANT)                || queryString([OPTION.HIDE_ASSISTANT]);
      this.hideRefresh               = cached(CACHE.REFRESH)                  || queryString([OPTION.HIDE_REFRESH]);
      this.hideUnusedEntities        = cached(CACHE.UNUSED_ENTITIES)          || queryString([OPTION.HIDE_UNUSED_ENTITIES]);
      this.hideReloadResources       = cached(CACHE.RELOAD_RESOURCES)         || queryString([OPTION.HIDE_RELOAD_RESOURCES]);
      this.hideEditDashboard         = cached(CACHE.EDIT_DASHBOARD)           || queryString([OPTION.HIDE_EDIT_DASHBOARD]);
      this.hideDialogHeaderHistory   = cached(CACHE.DIALOG_HEADER_HISTORY)    || queryString([OPTION.HIDE_DIALOG_HEADER_HISTORY]);
      this.hideDialogHeaderSettings  = cached(CACHE.DIALOG_HEADER_SETTINGS)   || queryString([OPTION.HIDE_DIALOG_HEADER_SETTINGS]);
      this.hideDialogHeaderOverflow  = cached(CACHE.DIALOG_HEADER_OVERFLOW)   || queryString([OPTION.HIDE_DIALOG_HEADER_OVERFLOW]);
      this.hideDialogHistory         = cached(CACHE.DIALOG_HISTORY)           || queryString([OPTION.HIDE_DIALOG_HISTORY]);
      this.hideDialogLogbook         = cached(CACHE.DIALOG_LOGBOOK)           || queryString([OPTION.HIDE_DIALOG_LOGBOOK]);
      this.hideDialogAttributes      = cached(CACHE.DIALOG_ATTRIBUTES)        || queryString([OPTION.HIDE_DIALOG_ATTRIBUTES]);
      this.hideDialogHistoryShowMore = cached(CACHE.DIALOG_HISTORY_SHOW_MORE) || queryString([OPTION.HIDE_DIALOG_HISTORY_SHOW_MORE]);
      this.hideDialogLogbookShowMore = cached(CACHE.DIALOG_LOGBOOK_SHOW_MORE) || queryString([OPTION.HIDE_DIALOG_LOGBOOK_SHOW_MORE]);
      this.blockOverflow             = cached(CACHE.OVERFLOW_MOUSE)           || queryString([OPTION.BLOCK_OVERFLOW]);
      this.blockMouse                = cached(CACHE.MOUSE)                    || queryString([OPTION.BLOCK_MOUSE]);
    }

    // Use config values only if config strings and cache aren't used.
    this.hideHeader = queryStringsSet
      ? this.hideHeader
      : config.kiosk || config.hide_header;
    this.hideSidebar = queryStringsSet
      ? this.hideSidebar
      : config.kiosk || config.hide_sidebar;
    this.hideOverflow = queryStringsSet
      ? this.hideOverflow
      : config.hide_overflow;
    this.hideMenuButton = queryStringsSet
      ? this.hideMenuButton
      : config.hide_menubutton;
    this.hideAccount = queryStringsSet
      ? this.hideAccount
      : config.hide_account;
    this.hideSearch = queryStringsSet
      ? this.hideSearch
      : config.hide_search;
    this.hideAssistant = queryStringsSet
      ? this.hideAssistant
      : config.hide_assistant;
    this.hideRefresh = queryStringsSet
      ? this.hideRefresh
      : config.hide_refresh;
    this.hideUnusedEntities = queryStringsSet
      ? this.hideUnusedEntities
      : config.hide_unused_entities;
    this.hideReloadResources = queryStringsSet
      ? this.hideReloadResources
      : config.hide_reload_resources;
    this.hideEditDashboard = queryStringsSet
      ? this.hideEditDashboard
      : config.hide_edit_dashboard;
    this.hideDialogHeaderHistory = queryStringsSet
      ? this.hideDialogHeaderHistory
      : config.hide_dialog_header_history;
    this.hideDialogHeaderSettings = queryStringsSet
      ? this.hideDialogHeaderSettings
      : config.hide_dialog_header_settings;
    this.hideDialogHeaderOverflow = queryStringsSet
      ? this.hideDialogHeaderOverflow
      : config.hide_dialog_header_overflow;
    this.hideDialogHistory = queryStringsSet
      ? this.hideDialogHistory
      : config.hide_dialog_history;
    this.hideDialogLogbook = queryStringsSet
      ? this.hideDialogLogbook
      : config.hide_dialog_logbook;
    this.hideDialogAttributes = queryStringsSet
      ? this.hideDialogAttributes
      : config.hide_dialog_attributes;
    this.hideDialogHistoryShowMore = queryStringsSet
      ? this.hideDialogHistoryShowMore
      : config.hide_dialog_history_show_more;
    this.hideDialogLogbookShowMore = queryStringsSet
      ? this.hideDialogLogbookShowMore
      : config.hide_dialog_logbook_show_more;
    this.blockOverflow = queryStringsSet
      ? this.blockOverflow
      : config.block_overflow;
    this.blockMouse = queryStringsSet
      ? this.blockMouse
      : config.block_mouse;

    // Admin non-admin config
    const adminConfig = this.user.is_admin
      ? config.admin_settings
      : config.non_admin_settings;

    if (adminConfig) {
      this.setOptions(adminConfig);
    }

    // User settings config
    if (config.user_settings) {
      toArray(config.user_settings).forEach((conf) => {
        if (toArray(conf.users).some((x) => x.toLowerCase() === this.user.name.toLowerCase())) {
          this.setOptions(conf);
        }
      });
    }

    // Mobile config
    const mobileConfig = this.ignoreMobile
      ? null
      : config.mobile_settings;

    if (mobileConfig) {
      const mobileWidth = mobileConfig.custom_width
        ? mobileConfig.custom_width
        : CUSTOM_MOBILE_WIDTH_DEFAULT;
      if (window.innerWidth <= mobileWidth) {
        this.setOptions(mobileConfig);
      }
    }

    // Entity config
    const entityConfig = this.ignoreEntity
      ? null
      : config.entity_settings;

    if (entityConfig) {
      for (let conf of entityConfig) {
        const entity = Object.keys(conf.entity)[0];
        if (!window.kioskModeEntities[dash].includes(entity)) window.kioskModeEntities[dash].push(entity);
        if (this.ha.hass.states[entity].state == conf.entity[entity]) {
          if (OPTION.HIDE_HEADER in conf)                   this.hideHeader                = conf[OPTION.HIDE_HEADER];
          if (OPTION.HIDE_SIDEBAR in conf)                  this.hideSidebar               = conf[OPTION.HIDE_SIDEBAR];
          if (OPTION.HIDE_OVERFLOW in conf)                 this.hideOverflow              = conf[OPTION.HIDE_OVERFLOW];
          if (OPTION.HIDE_MENU_BUTTON in conf)              this.hideMenuButton            = conf[OPTION.HIDE_MENU_BUTTON];
          if (OPTION.HIDE_ACCOUNT in conf)                  this.hideAccount               = conf[OPTION.HIDE_ACCOUNT];
          if (OPTION.HIDE_SEARCH in conf)                   this.hideSearch                = conf[OPTION.HIDE_SEARCH];
          if (OPTION.HIDE_ASSISTANT in conf)                this.hideAssistant             = conf[OPTION.HIDE_ASSISTANT];
          if (OPTION.HIDE_REFRESH in conf)                  this.hideRefresh               = conf[OPTION.HIDE_REFRESH];
          if (OPTION.HIDE_UNUSED_ENTITIES in conf)          this.hideUnusedEntities        = conf[OPTION.HIDE_UNUSED_ENTITIES];
          if (OPTION.HIDE_RELOAD_RESOURCES in conf)         this.hideReloadResources       = conf[OPTION.HIDE_RELOAD_RESOURCES];
          if (OPTION.HIDE_EDIT_DASHBOARD in conf)           this.hideEditDashboard         = conf[OPTION.HIDE_EDIT_DASHBOARD];
          if (OPTION.HIDE_DIALOG_HEADER_HISTORY in conf)    this.hideDialogHeaderHistory   = conf[OPTION.HIDE_DIALOG_HEADER_HISTORY];
          if (OPTION.HIDE_DIALOG_HEADER_SETTINGS in conf)   this.hideDialogHeaderSettings  = conf[OPTION.HIDE_DIALOG_HEADER_SETTINGS];
          if (OPTION.HIDE_DIALOG_HEADER_OVERFLOW in conf)   this.hideDialogHeaderOverflow  = conf[OPTION.HIDE_DIALOG_HEADER_OVERFLOW];
          if (OPTION.HIDE_DIALOG_HISTORY in conf)           this.hideDialogHistory         = conf[OPTION.HIDE_DIALOG_HISTORY];
          if (OPTION.HIDE_DIALOG_LOGBOOK in conf)           this.hideDialogLogbook         = conf[OPTION.HIDE_DIALOG_LOGBOOK];
          if (OPTION.HIDE_DIALOG_ATTRIBUTES in conf)        this.hideDialogAttributes      = conf[OPTION.HIDE_DIALOG_ATTRIBUTES];
          if (OPTION.HIDE_DIALOG_HISTORY_SHOW_MORE in conf) this.hideDialogHistoryShowMore = conf[OPTION.HIDE_DIALOG_HISTORY_SHOW_MORE];
          if (OPTION.HIDE_DIALOG_LOGBOOK_SHOW_MORE in conf) this.hideDialogLogbookShowMore = conf[OPTION.HIDE_DIALOG_LOGBOOK_SHOW_MORE];
          if (OPTION.BLOCK_OVERFLOW in conf)                this.blockOverflow             = conf[OPTION.BLOCK_OVERFLOW];
          if (OPTION.BLOCK_MOUSE in conf)                   this.blockMouse                = conf[OPTION.BLOCK_MOUSE];
          if (OPTION.KIOSK in conf)                         this.hideHeader                = this.hideSidebar = conf[OPTION.KIOSK];
        }
      }
    }

    // Do not run kiosk-mode if it is disabled
    if (
      queryString(OPTION.DISABLE_KIOSK_MODE) &&
      !this.ignoreDisableKm
    ) {
      return;
    }

    this.insertStyles();
  }

  protected insertStyles() {
  
    if (this.hideHeader) {
      addStyle(STYLES.HEADER, this.huiRoot);
      if (queryString(OPTION.CACHE)) setCache(CACHE.HEADER, TRUE);
    } else {
      removeStyle(this.huiRoot);
    }

    if (this.hideSidebar) {
      addStyle(STYLES.SIDEBAR, this.drawerLayout);
      addStyle(STYLES.ASIDE, this.drawerLayout.shadowRoot);
      if (queryString(OPTION.CACHE)) setCache(CACHE.SIDEBAR, TRUE);
    } else {
      removeStyle(this.drawerLayout);
      removeStyle(this.drawerLayout.shadowRoot);
    }

    if (
      this.hideAccount ||
      this.hideMenuButton
    ) {
      const styles = [
          this.hideAccount ? STYLES.ACCOUNT : '',
          this.hideMenuButton ? STYLES.MENU_BUTTON : ''
      ];
      addStyle(styles.join(''), this.sideBarRoot);
      if (this.hideAccount && queryString(OPTION.CACHE)) setCache(CACHE.ACCOUNT, TRUE);
    } else {
      removeStyle(this.sideBarRoot);
    }

    if (
      this.hideSearch ||
      this.hideAssistant ||
      this.hideRefresh ||
      this.hideUnusedEntities ||
      this.hideReloadResources ||
      this.hideEditDashboard ||
      this.hideMenuButton ||
      this.hideOverflow ||
      this.blockOverflow ||
      this.hideSidebar
    ) {
      const styles = [
          this.hideSearch ? STYLES.SEARCH : '',
          this.hideAssistant ? STYLES.ASSISTANT : '',
          this.hideRefresh ? STYLES.REFRESH : '',
          this.hideUnusedEntities ? STYLES.UNUSED_ENTITIES : '',
          this.hideReloadResources ? STYLES.RELOAD_RESOURCES : '',
          this.hideEditDashboard ? STYLES.EDIT_DASHBOARD : '',
          this.hideOverflow ? STYLES.OVERFLOW_MENU : '',
          this.blockOverflow ? STYLES.BLOCK_OVERFLOW : '',
          this.hideMenuButton || this.hideSidebar ? STYLES.MENU_BUTTON_BURGER : '',
      ];
      addStyle(styles.join(''), this.appToolbar);
      if (queryString(OPTION.CACHE)) {
          if (this.hideSearch) setCache(CACHE.SEARCH, TRUE);
          if (this.hideAssistant) setCache(CACHE.ASSISTANT, TRUE);
          if (this.hideRefresh) setCache(CACHE.REFRESH, TRUE);
          if (this.hideUnusedEntities) setCache(CACHE.UNUSED_ENTITIES, TRUE);
          if (this.hideReloadResources) setCache(CACHE.RELOAD_RESOURCES, TRUE);
          if (this.hideEditDashboard) setCache(CACHE.EDIT_DASHBOARD, TRUE);
          if (this.hideOverflow) setCache(CACHE.OVERFLOW, TRUE);
          if (this.blockOverflow) setCache(CACHE.OVERFLOW_MOUSE, TRUE);
          if (this.hideMenuButton) setCache(CACHE.MENU_BUTTON, TRUE);
      }
    } else {
      removeStyle(this.appToolbar);
    }

    if (this.blockMouse) {
      addStyle(STYLES.MOUSE, document.body);
      if (queryString(OPTION.CACHE)) setCache(CACHE.MOUSE, TRUE);
    } else {
      removeStyle(document.body);
    }

    // Resize event
    window.removeEventListener('resize', this.resizeWindowBinded);
    window.addEventListener('resize', this.resizeWindowBinded);

    // Resize window to 'refresh' view.
    window.dispatchEvent(new Event('resize'));
  }

  protected insertDialogStyles(dialog: HTMLElement) {
    
  }

  // Resize event
  protected resizeWindow() {
    window.clearTimeout(this.resizeDelay);
    this.resizeDelay = window.setTimeout(() => {
      this.updateMenuItemsLabels();
    }, WINDOW_RESIZE_DELAY);
  }

  // Run on dashboard change
  protected watchDashboards(mutations: MutationRecord[]) {
    mutations.forEach(({ addedNodes }): void => {
      addedNodes.forEach((node: Element): void => {
        if (node.localName === ELEMENT.HA_PANEL_LOVELACE) {
          window.KioskMode.run(node as Lovelace);
        }
      });
    });
  }

  // Run on more info dialogs change
  protected watchMoreInfoDialogs(mutations: MutationRecord[]) {
    mutations.forEach(({ addedNodes, removedNodes }): void => {
      addedNodes.forEach((node: Element): void => {
        if (node.localName === ELEMENT.HA_MORE_INFO_DIALOG) {
          window.KioskMode.runDialogs(node);
        }
      });
    });
  }

  // Run on button menu change
  protected updateMenuItemsLabels() {

    if (!this.menuTranslations) return;    

    getPromisableElement(
      (): NodeListOf<HTMLElement> => this.appToolbar.querySelectorAll<HTMLElement>(`${ELEMENT.TOOLBAR} > ${ELEMENT.ACTION_ITEMS} > ${ELEMENT.MENU_ITEM}`),
      (elements: NodeListOf<HTMLElement>): boolean => !!elements,
      `:scope > ${ELEMENT.ACTION_ITEMS} > ${ELEMENT.MENU_ITEM}`
    )
      .then((menuItems: NodeListOf<HTMLElement>) => {
        menuItems.forEach((menuItem: HTMLElement): void => {
          if (
            menuItem &&
            menuItem.dataset &&
            !menuItem.dataset.selector
          ) {
            const icon = menuItem.shadowRoot.querySelector<HTMLElement>(ELEMENT.MENU_ITEM_ICON);
            menuItem.dataset.selector = this.menuTranslations[icon.title];
          }
        });
      })
      .catch((message) => { console.warn(`${NAMESPACE}: ${NON_CRITICAL_WARNING} ${message}`) });

    if (this.user.is_admin) {

      getPromisableElement(
        (): NodeListOf<HTMLElement> => this.appToolbar.querySelectorAll(ELEMENT.OVERLAY_MENU_ITEM),
        (elements: NodeListOf<HTMLElement>) => !!(elements && elements.length),
        `${ELEMENT.TOOLBAR} > ${ELEMENT.OVERLAY_MENU_ITEM}`
      )
        .then((overflowMenuItems: NodeListOf<HTMLElement>) => {
          overflowMenuItems.forEach((overflowMenuItem: HTMLElement): void => {
            if (
              overflowMenuItem &&
              overflowMenuItem.dataset &&
              !overflowMenuItem.dataset.selector
            ) {
              const textContent = overflowMenuItem.textContent.trim();
              overflowMenuItem.dataset.selector = this.menuTranslations[textContent];
            }
          });
        })
        .catch((message) => { console.warn(`${NAMESPACE}: ${NON_CRITICAL_WARNING} ${message}`) });
    }
    
  }

  // Run on entity change
  protected async entityWatch() {
    (await window.hassConnection).conn.subscribeMessage((e) => this.entityWatchCallback(e), {
      type: SUSCRIBE_EVENTS_TYPE,
      event_type: STATE_CHANGED_EVENT,
    });
  }

  protected entityWatchCallback(event: SuscriberEvent) {
    const entities = window.kioskModeEntities[this.ha.hass.panelUrl] || [];
    if (
      entities.length &&
      event.event_type === STATE_CHANGED_EVENT &&
      entities.includes(event.data.entity_id) &&
      (!event.data.old_state || event.data.new_state.state !== event.data.old_state.state)
    ) {
      this.run();
    }
  }

  protected setOptions(config: ConditionalKioskConfig) {
    this.hideHeader                = config.kiosk || config.hide_header;
    this.hideSidebar               = config.kiosk || config.hide_sidebar;
    this.hideOverflow              = config.hide_overflow;
    this.hideMenuButton            = config.hide_menubutton;
    this.hideAccount               = config.hide_account;
    this.hideSearch                = config.hide_search;
    this.hideAssistant             = config.hide_assistant;
    this.hideRefresh               = config.hide_refresh;
    this.hideUnusedEntities        = config.hide_unused_entities;
    this.hideReloadResources       = config.hide_reload_resources;
    this.hideEditDashboard         = config.hide_edit_dashboard;
    this.hideDialogHeaderHistory   = config.hide_dialog_header_history;
    this.hideDialogHeaderSettings  = config.hide_dialog_header_settings;
    this.hideDialogHeaderOverflow  = config.hide_dialog_header_overflow;
    this.hideDialogHistory         = config.hide_dialog_history;
    this.hideDialogLogbook         = config.hide_dialog_logbook;
    this.hideDialogAttributes      = config.hide_dialog_attributes;
    this.hideDialogHistoryShowMore = config.hide_dialog_history_show_more;
    this.hideDialogLogbookShowMore = config.hide_dialog_logbook_show_more;
    this.blockOverflow             = config.block_overflow;
    this.blockMouse                = config.block_mouse;
    this.ignoreEntity              = typeof config.ignore_entity_settings === BOOLEAN
      ? config.ignore_entity_settings
      : this.ignoreEntity;
    this.ignoreMobile              = typeof config.ignore_mobile_settings === BOOLEAN
      ? config.ignore_mobile_settings
      : this.ignoreMobile;
    this.ignoreDisableKm           = typeof config.ignore_disable_km === BOOLEAN
      ? config.ignore_disable_km
      : this.ignoreDisableKm;
  }

}

// Console tag
const info = new ConInfo();
info.log();

// Initial Run
Promise.resolve(customElements.whenDefined(ELEMENT.HUI_VIEW))
  .then(() => {
    window.KioskMode = new KioskMode();
  });
