'use strict';
{
  (
    async function () {
      const { debounce, importFeatures, featureify, deepEquals } = await import('../scripts/utils/jsTools.js');
      const { noact } = await import('../scripts/utils/noact.js');
      const { camelCase } = await import('../scripts/utils/case.js');
      const Themes = await import('../scripts/themes.js');

      function kbToggleAction({ key }) {
        if (key === 'Enter') this.click();
      }

      async function onToggleFeature() {
        const name = this.getAttribute('name');
        const checked = this.checked ? true : false;
        let { preferences } = await browser.storage.local.get('preferences');

        if (checked) preferences[name].enabled = true;
        else preferences[name].enabled = false;
        browser.storage.local.set({ preferences });

        const secondaryContent = this.closest('li').querySelector('.ui-secondaryContent');
        if (secondaryContent) {
          const state = secondaryContent.getAttribute('active') === 'true' ? true : false;
          if (!state && checked || state && !checked) this.closest('.ui-primaryContent').querySelector('.ui-featureTitle').click();
        }
      }
      async function onTextInput({ target }) {
        const value = target.value;
        const [name, key] = target.name.split('-');
        let { preferences } = await browser.storage.local.get('preferences');
        preferences[name].options[key] = value;

        browser.storage.local.set({ preferences });
      }

      const newTitle = featureTitle => ({
        className: 'ui-featureTitle',
        onclick: function () {
          this.closest('li').dataset.new = false;
          const secondaryContent = this.closest('li').querySelector('.ui-secondaryContent');
          const caret = this.querySelector('svg');
          if (secondaryContent.getAttribute('active') === 'true') {
            secondaryContent.setAttribute('active', 'false');
            caret.style.transform = 'rotate(180deg)';
          } else {
            secondaryContent.setAttribute('active', 'true');
            caret.style.transform = 'rotate(360deg)';
          }
        },
        children: [
          {
            tag: 'h2',
            children: [featureTitle]
          },
          {
            className: 'ui-caretWrapper',
            children: [{
              tag: 'svg',
              width: 24,
              height: 24,
              style: 'transform: rotate(180deg);',
              children: [{
                tag: 'use',
                href: '#icons-caret'
              }]
            }]
          }
        ]
      });

      const newFeatureItem = (name, feature = {}, preference = {}) => {
        let featureItem;

        try {
          featureItem = noact({
            tag: 'li',
            dataset: {
              searchable: JSON.stringify(feature),
              new: preference.new ? true : false
            },
            children: [
              {
                className: 'ui-primaryContent',
                children: [
                  newTitle(feature.title),
                  {
                    className: 'ui-toggleWrapper',
                    children: [
                      {
                        tag: 'input',
                        type: 'checkbox',
                        className: 'ui-toggle',
                        id: `ui-feature-${name}`,
                        name: feature.name,
                        'aria-hidden': true,
                        onchange: onToggleFeature
                      },
                      {
                        tag: 'label',
                        for: `ui-feature-${name}`,
                        'aria-role': 'switch',
                        tabindex: 0,
                        onkeydown: kbToggleAction,
                        children: `toggle ${feature.name}`,
                      }
                    ]
                  }
                ]
              },
              {
                className: 'ui-secondaryContent',
                children: [
                  'description' in feature ? { children: [feature.description] } : null,
                  'extendedDescription' in feature ? feature.extendedDescription : null,
                  'links' in feature ? {
                    tag: 'p',
                    children: [
                      'See: ',
                      feature.links.map((link, i) => {
                        return [
                          {
                            href: link.url,
                            children: [link.text]
                          },
                          i === feature.links.length - 1 ? '' : ', '
                        ]
                      })
                    ]
                  } : ''
                ]
              }
            ]
          });

          if (preference.enabled) {
            const input = featureItem.querySelector('input');
            input.setAttribute('checked', '');
            input.setAttribute('aria-checked', 'true');
          }

          if ('options' in preference) {
            const optionsWrapper = noact({
              className: 'ui-options',
              children: {
                tag: 'h2',
                children: 'Options'
              }
            });

            Object.entries(feature.preferences.options).forEach(([key, option]) => {
              option.name ??= option.title;

              const tooltip = option.tooltip ? noact({
                className: 'ui-tooltipAnchor',
                children: {
                  className: 'ui-tooltip',
                  children: option.tooltip
                }
              }) : null;
              let wrapper;

              switch (option.type) {
                case 'toggle': {
                  wrapper = noact({
                    className: 'ui-inputWrapper ui-checkboxWrapper',
                    children: [
                      {
                        tag: 'input',
                        id: `ui-feature-${name}-${key}`,
                        className: 'ui-checkbox',
                        name: `${name}-${key}`,
                        checked: preference.options[key],
                        ariaChecked: preference.options[key],
                        onkeydown: kbToggleAction,
                        onchange: async function () {
                          const checked = this.checked ? true : false;
                          this.setAttribute('aria-checked', checked);
                          let { preferences } = await browser.storage.local.get('preferences');

                          if (checked) preferences[name].options[key] = true;
                          else preferences[name].options[key] = false;

                          browser.storage.local.set({ preferences });
                        },
                        type: 'checkbox'
                      },
                      {
                        tag: 'label',
                        for: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        children: option.name
                      }
                    ]
                  });
                  break;
                } case 'select': {
                  wrapper = noact({
                    className: 'ui-inputWrapper',
                    children: [
                      {
                        tag: 'label',
                        for: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        children: option.name
                      },
                      {
                        tag: 'select',
                        id: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        onchange: async function () {
                          const { value } = this;
                          let { preferences } = await browser.storage.local.get('preferences');

                          [...this.children].forEach(o => {
                            o.setAttribute('aria-selected', o.value === value);
                          });

                          preferences[name].options[key] = value;

                          browser.storage.local.set({ preferences });
                        },
                        children: Object.values(option.options).map(subOption => ({
                          tag: 'option',
                          value: subOption.value,
                          selected: preference.options[key] === subOption.value,
                          ariaSelected: preference.options[key] === subOption.value,
                          children: subOption.name
                        }))
                      }
                    ]
                  });
                  break;
                } case 'multiSelect': {
                  wrapper = noact({
                    tag: 'ui-inputWrapper',
                    children: [
                      {
                        tag: 'label',
                        for: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        children: option.name
                      },
                      {
                        className: 'ui-multiSelectWrapper',
                        children: Object.entries(option.options).map(([subKey, subOption]) => ({
                          className: 'ui-checkboxWrapper',
                          children: [
                            {
                              tag: 'label',
                              for: `ui-feature-${name}-${key}-${subKey}`,
                              name: `${name}-${key}-${subKey}`,
                              ariaRole: 'switch',
                              children: subOption.name
                            },
                            {
                              tag: 'input',
                              id: `ui-feature-${name}-${key}-${subKey}`,
                              className: 'ui-checkbox',
                              name: `${name}-${key}-${subKey}`,
                              ariaHidden: true,
                              checked: preference.options[key][subKey],
                              ariaChecked: preference.options[key][subKey],
                              onchange: async function () {
                                const checked = !!this.checked;
                                let { preferences } = await browser.storage.local.get('preferences');

                                this.setAttribute('aria-checked', checked);
                                if (checked) preferences[name].options[key][subKey] = true;
                                else preferences[name].options[key][subKey] = false;

                                browser.storage.local.set({ preferences });
                              }
                            }
                          ]
                        }))
                      }
                    ]
                  });
                  break;
                } case 'listSelect': {
                  wrapper = noact({
                    className: 'ui-inputWrapper',
                    children: [
                      {
                        tag: 'label',
                        for: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        children: option.name
                      },
                      {
                        className: 'ui-listSelectWrapper',
                        children: option.options.map(listItem => {
                          const listItemName = camelCase(listItem);

                          return [
                            {
                              tag: 'input',
                              id: `ui-feature-${name}-${key}-${listItemName}`,
                              className: 'ui-listSelect',
                              name: `${name}-${key}-${listItemName}`,
                              type: 'checkbox',
                              ariaHidden: true,
                              checked: preference.options[key].includes(listItem),
                              ariaChecked: preference.options[key].includes(listItem),
                              onchange: async function () {
                                const checked = !!this.checked;
                                let { preferences } = await browser.storage.local.get('preferences');

                                if (checked) preferences[name].options[key].push(listItem);
                                else preferences[name].options[key] = preferences[name].options[key].filter(item => item !== listItem);

                                browser.storage.local.set({ preferences });
                              }
                            },
                            {
                              tag: 'label',
                              for: `ui-feature-${name}-${key}-${listItemName}`,
                              name: `${name}-${key}-${listItemName}`,
                              children: listItem
                            }
                          ]
                        })
                      }
                    ]
                  });
                  break;
                } case 'number': {
                  wrapper = noact({
                    className: 'ui-inputWrapper ui-numInputWrapper',
                    children: [
                      {
                        tag: 'label',
                        for: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        children: option.name
                      },
                      {
                        tag: 'input',
                        type: 'number',
                        id: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        className: 'ui-numInput',
                        placeholder: option.value,
                        min: option.min,
                        ariaValuemin: option.min,
                        max: option.max,
                        ariaValuemax: option.max,
                        step: option.step,
                        style: `width: ${String(option.max).length}em;`,
                        value: preference.options[key],
                        ariaValuenow: preference.options[key],
                        onchange: async function () {
                          const value = this.value;
                          this.setAttribute('aria-valuenow', value);
                          let { preferences } = await browser.storage.local.get('preferences');
                          preferences[name].options[key] = +value;
                          browser.storage.local.set({ preferences });
                        }
                      }
                    ]
                  });
                  break;
                } case 'range': {
                  wrapper = noact({
                    className: 'ui-inputWrapper ui-rangeInputWrapper',
                    children: [
                      {
                        tag: 'label',
                        id: `ui-feature-${name}-${key}-label`,
                        for: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        children: `${option.name} (value: ${preference.options[key]}${option.unit || ''})`
                      },
                      {
                        tag: 'input',
                        type: 'range',
                        ariaRole: 'slider',
                        id: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        className: 'ui-rangeInput',
                        placeholder: option.value,
                        min: option.min,
                        ariaValuemin: option.min,
                        max: option.max,
                        ariaValuemax: option.max,
                        step: option.step,
                        list: 'list' in option ? `${name}-${key}-list` : '',
                        value: preference.options[key],
                        ariaValuenow: preference.options[key],
                        onchange: async function () {
                          const value = this.value;
                          this.setAttribute('aria-valuenow', value);
                          let { preferences } = await browser.storage.local.get('preferences');
                          preferences[name].options[key] = +value;
                          document.getElementById(`ui-feature-${name}-${key}-label`).textContent = `${option.name} (value: ${value}${option.unit || ''})`;
                          browser.storage.local.set({ preferences });
                        }
                      },
                      'list' in option ? {
                        tag: 'datalist',
                        children: option.list.map(({ value, label }) => ({
                          tag: 'option',
                          value,
                          label
                        }))
                      } : null
                    ]
                  });
                  break;
                } case 'text': {
                  wrapper = noact({
                    className: 'ui-inputWrapper',
                    children: [
                      {
                        tag: 'label',
                        for: `ui-feature-${name}-${key}`,
                        name: `${name}-${key}`,
                        children: option.name
                      },
                      {
                        tag: option.textarea ? 'textarea' : 'input',
                        id: `ui-feature-${name}-${key}`,
                        className: 'ui-textInput',
                        type: 'text',
                        autocorrect: 'off',
                        spellcheck: 'false',
                        placeholder: option.placeholder,
                        list: 'list' in option ? `${name}-${key}-list` : '',
                        name: `${name}-${key}`,
                        value: preference.options[key],
                        oninput: debounce(onTextInput),
                        children: option.textarea ? preference.options[key] : null
                      },
                      'list' in option ? {
                        tag: 'datalist',
                        children: option.list.map(({ value, label }) => ({
                          tag: 'option',
                          value,
                          label
                        }))
                      } : null
                    ]
                  });
                  break;
                } default: {
                  console.warn(`[PawJob-Menu] Cannot render option ${name}.${key}: missing support for type '${option.type}'`);
                  break;
                }
              }

              tooltip && (wrapper.append(tooltip));
              wrapper && optionsWrapper.append(wrapper);
            });

            featureItem.querySelector('.ui-secondaryContent').append(optionsWrapper);
          }
        } catch (e) {
          console.error(`[PawJob-Config] Error creating feature item '${name}':`, e);
        }

        return featureItem;
      };

      const setupButtons = className => {
        document.querySelectorAll(`.${className}`).forEach(btn => btn.addEventListener('click', function () {
          [...this.closest(`#${className}s`).querySelectorAll(`:scope .${className}`)].filter(elem => elem.matches(`.${className}`)).forEach(btn => btn.setAttribute('active', 'false'));
          this.setAttribute('active', 'true');
          let target = `ui-${this.getAttribute('target')}`;
          target = document.getElementById(target);
          const classes = target.classList;
          [...target.parentElement.children].filter(elem => elem.matches(`.${[...classes].join('.')}`)).forEach(elem => elem.setAttribute('active', 'false'));
          target.setAttribute('active', 'true');
        }));
      };

      const createFeatures = (installedFeatures, preferences) => {
        document.querySelectorAll('[data-searchable]').forEach(s => s.remove());
        const container = document.getElementById('ui-featureContainer');

        Object.keys(installedFeatures).forEach(key => {
          const feature = installedFeatures[key];
          const preference = preferences[key];

          if (feature && preference) {
            const featureItem = newFeatureItem(key, feature, preference, preferences);
            container.append(featureItem);
          }
        });

        filterAlphabetical();
      };

      const filterAlphabetical = (reverse = false) => {
        const container = document.getElementById('ui-featureContainer');
        const indexMap = reverse ? [1, -1] : [-1, 1];
        container.replaceChildren(...Array.from(container.children).sort((a, b) => {
          if (!a.dataset.searchable) return -1;
          else if (!b.dataset.searchable) return 1;
          const dataA = JSON.parse(a.dataset.searchable);
          const dataB = JSON.parse(b.dataset.searchable);

          return indexMap[[dataA.title, dataB.title].sort().indexOf(dataA.title)];
        }));
      };

      const enabledSelector = ':has(input:checked:not([dummy], .ui-options input)),:has(input[active="true"])';
      const filterEnabled = (reverse = false) => {
        const container = document.getElementById('ui-featureContainer');
        const indexMap = reverse ? [1, -1] : [-1, 1];
        container.replaceChildren(...Array.from(container.children).sort((a, b) => {
          if (!a.dataset.searchable) return -1;
          else if (!b.dataset.searchable) return 1;

          if (a.matches(enabledSelector) && !b.matches(enabledSelector)) return indexMap[0];
          else if (!a.matches(enabledSelector) && b.matches(enabledSelector)) return indexMap[1];
          else return 0;
        }));
      };

      const onSearch = ({ target }) => {
        const query = target.value.replace(/[^\w]/g, '');
        if (query) {
          document.getElementById('ui-searchFilter').innerText = `
          #ui-featureContainer > li:not([data-searchable*="${query}" i]) { display: none; }
        `;
        }
        else document.getElementById('ui-searchFilter').innerText = '';
      };

      const clampY = y => y + 456 <= visualViewport.height ? y : visualViewport.height - 456;
      const clampX = x => x + 240 <= visualViewport.width ? x : visualViewport.width - 256;

      const changeWidgetState = widget => {
        document.querySelectorAll('.ui-filterWidgets button').forEach(b => b.dataset.state = '');
        widget.dataset.state = 'active';
      };

      const init = async () => {
        const [contextKey, contextValue] = location.search.replace('?', '').split('=');

        if (contextKey) document.documentElement.setAttribute(`data-${contextKey}`, contextValue);
        if (contextKey === 'popup') {
          document.body.style.minHeight = '6000px';
          document.body.style.overflow = 'hidden';
        }

        const installedFeatures = await importFeatures(); // "await has no effect on this type of expression"- it does, actually!
        let { preferences, } = await browser.storage.local.get();

        if (typeof preferences === 'undefined') {
          preferences = featureify(installedFeatures, preferences);
        }

        if (preferences.themes?.enabled) Themes.main();
        browser.storage.onChanged.addListener(async (changes, areaName) => {
          const { preferences } = changes;
          if (areaName !== 'local' || typeof preferences === 'undefined') return;

          const newPref = preferences.newValue.themes;
          const changed = Object.keys(preferences.newValue).filter(key => !deepEquals(preferences?.newValue[key], preferences?.oldValue[key]));

          if (changed.includes('themes') && newPref.enabled) Themes.update(newPref.options);
          else if (!newPref.enabled) Themes.clean();
        });

        createFeatures(installedFeatures, preferences);

        const parsePreferenceText = text => {
          preferences = JSON.parse(text);

          if (typeof preferences === 'object') {
            browser.storage.local.set({ preferences });
            console.log('[PawJob-Menu] Successfully imported preferences!');
          } else throw 'Invalid data type';

          createFeatures(installedFeatures, preferences);
          document.getElementById('ui-preferenceText').value = JSON.stringify(preferences, null, 2);
        };

        setupButtons('ui-tab');
        document.getElementById('ui-preferenceText').value = JSON.stringify(preferences, null, 2);

        document.getElementById('ui-export').addEventListener('click', async function () {
          const { preferences } = await browser.storage.local.get('preferences');
          const preferenceExport = new Blob([JSON.stringify(preferences, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(preferenceExport);
          const exportLink = document.createElement('a');
          const date = new Date();
          const yy = date.getFullYear().toString();
          const mm = (date.getMonth() + 1).toString(); // zero-based
          const dd = date.getDate().toString();
          exportLink.href = url;
          exportLink.download = `Tailfeather Preference Export ${mm}-${dd}-${yy}`;

          document.documentElement.append(exportLink);
          exportLink.click();
          exportLink.remove();
          URL.revokeObjectURL(url);
        });
        document.getElementById('ui-textImport').addEventListener('click', function () {
          const input = document.getElementById('ui-preferenceText');
          if (!input.value) return;

          try {
            parsePreferenceText(input.value);
          } catch (e) {
            console.error('[PawJob-Menu] Failed to import preferences from text!', e);
            this.textContent = 'Import failed!';
            this.style.backgroundColor = 'rgb(var(--red))';
            setTimeout(() => {
              this.textContent = 'Import from textarea';
              this.style.backgroundColor = 'rgb(var(--white))';
            }, 2000);
          }

          createFeatures(installedFeatures, preferences);
        })
        document.getElementById('ui-import').addEventListener('click', function () {
          if (contextKey === 'popup') window.open(window.location.href.split('?')[0] + '?importFromFile=true');
          else document.getElementById('ui-fileImport').click();
        });
        document.getElementById('ui-fileImport').addEventListener('change', function () {
          if (this.files.length) {
            const reader = new FileReader();
            reader.readAsText(this.files[0]);
            reader.addEventListener('load', () => {
              const button = document.getElementById('ui-import');

              try {
                parsePreferenceText(reader.result);
                button.textContent = 'import successful!';
              } catch (e) {
                console.error('[PawJob-Menu] Failed to import preferences from text!', e);
                button.textContent = 'import failed!';
                button.style.backgroundColor = 'rgb(var(--red))';
              } finally {
                setTimeout(() => {
                  button.textContent = 'import from file';
                  button.style.backgroundColor = null;
                }, 2000);
              }
            });
          }
        });
        document.getElementById('ui-reset').addEventListener('click', function () {
          const preferences = {};

          browser.storage.local.set({ preferences });
          createFeatures(installedFeatures, preferences);
        });
        document.getElementById('ui-filterAlphabetical').addEventListener('click', function () {
          changeWidgetState(this);
          filterAlphabetical();
        });
        document.getElementById('ui-filterReverseAlphabetical').addEventListener('click', function () {
          changeWidgetState(this);
          filterAlphabetical(true);
        });
        document.getElementById('ui-filterEnabled').addEventListener('click', function () {
          changeWidgetState(this);
          filterEnabled();
        });
        document.getElementById('ui-filterDisabled').addEventListener('click', function () {
          changeWidgetState(this);
          filterEnabled(true);
        });
        document.querySelector('.ui-featureTab[target="search"]').addEventListener('click', function () {
          document.getElementById('ui-featureSearch').focus();
        });
        document.getElementById('ui-featureSearch').addEventListener('input', debounce(onSearch));

        const version = browser.runtime.getManifest().version;
        document.getElementById('version').textContent = `Version: v${version}`;

        Object.keys(preferences).forEach(key => { if (preferences[key].new) delete preferences[key].new; });
        browser.storage.local.set({ preferences });

        if (location.search === '?importFromFile=true') {
          document.querySelector('.ui-tab[target="manage"]').click();
          //document.getElementById('ui-import').click();
        }
      };

      init();
    }()
  )
}