/* === COMPONENTS =============================================================================== */

//============//
// UI OVERLAY //
//============//

class MorphUI extends HTMLElement {
  constructor() {
    super();
  }

  css = () => /* css */ `
    
    :host {
      align-items: end;
      background: #00000000;
      display: grid;
      font-family: sans-serif;
      height: 100svh;
      justify-content: center;
      left: 0;
      position: fixed;
      top: 0;
      width: 100vw;;
    }

    *,
    * ::before,
    * ::after {
      box-sizing: border-box;
      font-size: 12px;
      margin: 0;
      padding: 0;
    }

    article {
      align-items: stretch;
      backdrop-filter: blur(10px);
      background: linear-gradient( #9E9E9E66, #FAFAFA66);
      border: solid 1px #fafafa44;
      box-shadow: 0 0.5rem 1.5rem #607D8B44;
      border-radius: 1em;
      display: grid;
      gap: 0.75em;
      padding: 1.5em;
      user-select: none;
      margin-bottom: 2em;
      width: 360px; 
    }

    label {
      display: flex;
      flex-direction: column;
    }

  `; 

  html = () => /* html */ `

      <article>
        <label for="orbit-x">
          Orbit-X:
          <input name="orbit-x" is="attached-to-prop" prop="--orbit-x" type="range" min="0" max="1" step="0.001">
        </label>
        <label for="orbit-y">
          Orbit-Y:
          <input name="orbit-y" is="attached-to-prop" prop="--orbit-y" type="range" min="0" max="1" step="0.001">
        </label>
        <label for="depth-mod">
          Depth-mod:
          <input name="depth-mod" is="attached-to-prop" prop="--depth-mod" type="range" min="0" max="1" step="0.001">
        </label>
      </article>

  `;

  render() {
    this.shadowRoot.innerHTML = `
        <style>${this.css().trim()}</style>
            ${this.html().trim()}
        `;
  }

  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.render();
  }

}

customElements.define('morph-ui', MorphUI);

//=============//
// MORPH INPUT //
//=============//
/*
1. Should be a valid css custom property name, eg. --my-custom-prop.
2. The value of the custom property should match the input type
- eg.: '--my-custom-color: #212121;' for <input is="attached-to-prop" prop="--my-custom-color" type="color">
*/

class MorphInput extends HTMLInputElement {
  static observedAttributes = ['prop'];

  constructor() {
    super();
  }

  connectedCallback() {
    this.prop = this.getAttribute('prop');
    this.value = document.documentElement.computedStyleMap().get(this.prop) || this.defaultValue;
    this.addEventListener('input', this);
    this.addEventListener('change', this);
  }

  handleEvent(event) {
    if (event.type == 'input') {
      document.documentElement.style.setProperty(this.prop, this.value);
    } else if (event.type == 'change') {
      console.log(`${this.prop}: ${this.value}`);
    } else {
      return;
    }
  }

  disconnectedCallback() {
    this.removeEventListener('input', this);
    this.removeEventListener('change', this);
  }

  attributeChangedCallback(prop) {
    this.prop = this.getAttribute('prop');
    this.value = document.documentElement.computedStyleMap().get(this.prop) || this.defaultValue;
  }
}

customElements.define("attached-to-prop", MorphInput, { extends: 'input' });


/* === APPEND UI ================================================================================ */

const overlay = document.createElement('morph-ui');
document.body.appendChild(overlay);


/* === COPY TO CLIPBOARD ======================================================================== */

//===============//
// EXPORT SCRIPT //
//===============//
// Copy token values to clipboard on click of a button.
// (No need to save params since the goal is to have only one slider with clearly labeled personalities.)