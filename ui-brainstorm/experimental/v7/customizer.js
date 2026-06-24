/* ============================================================
   SINGULARITY V7 — CUSTOMIZER MODULE
   animalDatabase + drawer panel + persistencia
   ============================================================ */

const CustomizerAPI = (function() {
  let drawerEl = null;
  let isOpen = false;
  let currentSpecies = 'gato';
  let currentBreed = '';
  let config = {
    species: 'gato',
    ears: 'cat',
    pattern: 'pattern-calico-1',
    colors: { base: '#FFFFFF', spot1: '#E5954B', spot2: '#211E1F', ears: '#211E1F' },
    eyes: { light: '#E8F196', main: '#95C23D', dark: '#4A7314', pupil: '#0D0D0D' },
    accessory: 'cascabel',
    glasses: 'none',
    hat: 'none',
    collar: '#D33C37',
    hatColor: '#3B82F6',
    glassesColor: '#1F2937'
  };

  // ============================================================
  // ANIMAL DATABASE
  // ============================================================
  const animalDatabase = {
    gato: {
      ears: 'cat',
      breeds: {
        calico: { name: 'Calic\u00f3', variations: [
          { id: 'pattern-calico-1', name: 'Original', activePickers: ['base','spot1','spot2','ears'], labels: { base:'Base', spot1:'Naranja', spot2:'Negro', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#E5954B', s2:'#211E1F', ears:'#211E1F', eyeL:'#E8F196', eyeM:'#95C23D', eyeD:'#4A7314', pupil:'#0D0D0D' } },
          { id: 'pattern-calico-2', name: 'Manchitas', activePickers: ['base','spot1','spot2','ears'], labels: { base:'Base', spot1:'Naranja', spot2:'Negro', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#E5954B', s2:'#211E1F', ears:'#E5954B', eyeL:'#E8F196', eyeM:'#95C23D', eyeD:'#4A7314', pupil:'#0D0D0D' } },
          { id: 'pattern-calico-3', name: 'Antifaz', activePickers: ['base','spot1','spot2','ears'], labels: { base:'Base', spot1:'Izq', spot2:'Der', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#E5954B', s2:'#211E1F', ears:'#211E1F', eyeL:'#FDEB9E', eyeM:'#E5A626', eyeD:'#996311', pupil:'#0D0D0D' } }
        ]},
        tabby: { name: 'Tabby', variations: [
          { id: 'pattern-tabby-1', name: 'Clasico', activePickers: ['base','spot2','ears'], labels: { base:'Fondo', spot2:'Rayas', ears:'Orejas' }, preset: { base:'#FAD6A5', s1:'#D67D33', s2:'#B55A12', ears:'#D67D33', eyeL:'#FDEB9E', eyeM:'#E5A626', eyeD:'#996311', pupil:'#0D0D0D' } },
          { id: 'pattern-tabby-2', name: 'Tigre', activePickers: ['base','spot2','ears'], labels: { base:'Fondo', spot2:'Rayas', ears:'Orejas' }, preset: { base:'#DCDCDC', s1:'#888888', s2:'#555555', ears:'#888888', eyeL:'#A5E6FA', eyeM:'#4BADE5', eyeD:'#1F6895', pupil:'#0D0D0D' } },
          { id: 'pattern-tabby-3', name: 'Mackerel', activePickers: ['base','spot2','ears'], labels: { base:'Fondo', spot2:'Puntos', ears:'Orejas' }, preset: { base:'#E2CDAE', s1:'#8A6343', s2:'#5A3F27', ears:'#8A6343', eyeL:'#E8F196', eyeM:'#95C23D', eyeD:'#4A7314', pupil:'#0D0D0D' } }
        ]},
        tuxedo: { name: 'Tuxedo', variations: [
          { id: 'pattern-tuxedo-1', name: 'Esmoquin', activePickers: ['base','spot1','ears'], labels: { base:'Manto', spot1:'Pecho', ears:'Orejas' }, preset: { base:'#211E1F', s1:'#FFFFFF', s2:'#FFFFFF', ears:'#211E1F', eyeL:'#E8F196', eyeM:'#95C23D', eyeD:'#4A7314', pupil:'#0D0D0D' } }
        ]},
        solido: { name: 'Solido', variations: [
          { id: 'pattern-solid', name: 'Un Color', activePickers: ['base'], labels: { base:'Unico' }, preset: { base:'#211E1F', s1:'#211E1F', s2:'#211E1F', ears:'#211E1F', eyeL:'#FDEB9E', eyeM:'#E5A626', eyeD:'#996311', pupil:'#0D0D0D' } }
        ]},
        siamese: { name: 'Siam\u00e9s', variations: [
          { id: 'pattern-siamese-1', name: 'Siam\u00e9s', activePickers: ['base','spot2','ears'], labels: { base:'Cuerpo', spot2:'Puntos', ears:'Orejas' }, preset: { base:'#F5E6D3', s1:'#D4B895', s2:'#5C4033', ears:'#5C4033', eyeL:'#A5E6FA', eyeM:'#4BADE5', eyeD:'#1F6895', pupil:'#0D0D0D' } }
        ]},
        custom: { name: 'Custom', isCustom: true, variations: [
          { id: 'pattern-solid', name: 'Libre', activePickers: ['base','spot1','spot2','ears'], labels: { base:'Base', spot1:'Mancha1', spot2:'Mancha2', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#E5954B', s2:'#211E1F', ears:'#211E1F', eyeL:'#E8F196', eyeM:'#95C23D', eyeD:'#4A7314', pupil:'#0D0D0D' } }
        ]}
      }
    },
    perro: {
      ears: 'dog-up',
      breeds: {
        shiba: { name: 'Shiba', ears: 'dog-up', variations: [
          { id: 'pattern-dog-shiba', name: 'Urajiro', activePickers: ['base','spot1','ears'], labels: { base:'Hocico', spot1:'Manto', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#E5954B', s2:'#FFFFFF', ears:'#E5954B', eyeL:'#FDEB9E', eyeM:'#E5A626', eyeD:'#996311', pupil:'#0D0D0D' } }
        ]},
        husky: { name: 'Husky', ears: 'dog-up', variations: [
          { id: 'pattern-dog-husky', name: 'Antifaz', activePickers: ['base','spot2','ears'], labels: { base:'Hocico', spot2:'Manto', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#FFFFFF', s2:'#334155', ears:'#334155', eyeL:'#A5E6FA', eyeM:'#4BADE5', eyeD:'#1F6895', pupil:'#0D0D0D' } }
        ]},
        golden: { name: 'Golden', ears: 'dog-flop', variations: [
          { id: 'pattern-solid', name: 'Solido', activePickers: ['base','ears'], labels: { base:'Manto', ears:'Orejas' }, preset: { base:'#FCD34D', s1:'#FCD34D', s2:'#FCD34D', ears:'#FBBF24', eyeL:'#FDEB9E', eyeM:'#E5A626', eyeD:'#996311', pupil:'#0D0D0D' } }
        ]},
        border: { name: 'Border Collie', ears: 'dog-flop', variations: [
          { id: 'pattern-dog-tuxedo', name: 'Tuxedo', activePickers: ['base','spot1','ears'], labels: { base:'Manto', spot1:'Pecho', ears:'Orejas' }, preset: { base:'#211E1F', s1:'#FFFFFF', s2:'#FFFFFF', ears:'#211E1F', eyeL:'#FDEB9E', eyeM:'#E5A626', eyeD:'#996311', pupil:'#0D0D0D' } }
        ]},
        dalmata: { name: 'Dalmata', ears: 'dog-flop', variations: [
          { id: 'pattern-dog-dalmata', name: 'Punteado', activePickers: ['base','spot2','ears'], labels: { base:'Fondo', spot2:'Manchas', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#FFFFFF', s2:'#211E1F', ears:'#211E1F', eyeL:'#A5E6FA', eyeM:'#4BADE5', eyeD:'#1F6895', pupil:'#0D0D0D' } }
        ]},
        custom: { name: 'Custom', isCustom: true, ears: 'dog-up', variations: [
          { id: 'pattern-solid', name: 'Libre', activePickers: ['base','spot1','spot2','ears'], labels: { base:'Base', spot1:'Mancha1', spot2:'Mancha2', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#E5954B', s2:'#211E1F', ears:'#211E1F', eyeL:'#E8F196', eyeM:'#95C23D', eyeD:'#4A7314', pupil:'#0D0D0D' } }
        ]}
      }
    },
    erizo: {
      ears: 'hedgehog',
      breeds: {
        estandar: { name: 'Marron', variations: [
          { id: 'pattern-solid', name: 'Original', activePickers: ['base','spot2','spot1','ears'], labels: { base:'Cara', spot2:'Puas', spot1:'Trompa', ears:'Orejas' }, preset: { base:'#EED9C4', s1:'#D4B895', s2:'#5C4033', ears:'#D4B895', eyeL:'#FDEB9E', eyeM:'#E5A626', eyeD:'#996311', pupil:'#0D0D0D' } }
        ]},
        custom: { name: 'Custom', isCustom: true, variations: [
          { id: 'pattern-solid', name: 'Libre', activePickers: ['base','spot1','spot2','ears'], labels: { base:'Cara', spot1:'Trompa', spot2:'Puas', ears:'Orejas' }, preset: { base:'#FFFFFF', s1:'#E5954B', s2:'#211E1F', ears:'#211E1F', eyeL:'#E8F196', eyeM:'#95C23D', eyeD:'#4A7314', pupil:'#0D0D0D' } }
        ]}
      }
    }
  };

  // ============================================================
  // DRAWER PANEL HTML
  // ============================================================
  function getDrawerHTML() {
    return `
      <div class="cust-header">
        <div>
          <div class="badge text-muted mb-0.5">personalizacion</div>
          <div class="text-sm font-semibold text-fg">Avatar de Kali</div>
        </div>
        <button onclick="CustomizerAPI.toggle()" class="w-8 h-8 rounded-lg hover:bg-white/8 text-muted hover:text-fg transition flex items-center justify-center" aria-label="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="cust-body">
        <!-- 1. Especie -->
        <div class="customizer-section">
          <h3>1. Especie</h3>
          <div class="cust-btn-grid cols-3">
            <button class="cust-btn species-btn active" data-species="gato" onclick="CustomizerAPI.selectSpecies('gato')"><span class="emoji">\u{1F431}</span> Gato</button>
            <button class="cust-btn species-btn" data-species="perro" onclick="CustomizerAPI.selectSpecies('perro')"><span class="emoji">\u{1F436}</span> Perro</button>
            <button class="cust-btn species-btn" data-species="erizo" onclick="CustomizerAPI.selectSpecies('erizo')"><span class="emoji">\u{1F994}</span> Erizo</button>
          </div>
        </div>

        <!-- 2. Raza y Patron -->
        <div class="customizer-section">
          <h3>2. Raza y Patron</h3>
          <div id="breed-container" class="cust-btn-grid cols-3 mb-3"></div>
          <div id="variation-wrapper" class="border-t border-white/5 pt-3 mt-3">
            <div class="badge text-muted mb-2">Variantes</div>
            <div id="variation-container" class="flex flex-wrap gap-2"></div>
          </div>
        </div>

        <!-- 3. Colores (Pintor) -->
        <div class="customizer-section">
          <h3>3. Pintor <span class="text-[8px] text-muted ml-1">Automatico</span></h3>
          <div class="cust-color-pickers" id="color-pickers-container">
            <div class="cust-picker-wrap" id="wrap-base"><input type="color" id="color-base" value="#FFFFFF" oninput="CustomizerAPI.handleColorChange('base', this.value)"><label class="cust-picker-label" id="label-base">Base</label></div>
            <div class="cust-picker-wrap" id="wrap-spot1"><input type="color" id="color-spot1" value="#E5954B" oninput="CustomizerAPI.handleColorChange('spot1', this.value)"><label class="cust-picker-label" id="label-spot1">Mancha 1</label></div>
            <div class="cust-picker-wrap" id="wrap-spot2"><input type="color" id="color-spot2" value="#211E1F" oninput="CustomizerAPI.handleColorChange('spot2', this.value)"><label class="cust-picker-label" id="label-spot2">Mancha 2</label></div>
            <div class="cust-picker-wrap" id="wrap-ears"><input type="color" id="color-ears" value="#211E1F" oninput="CustomizerAPI.handleColorChange('ears', this.value)"><label class="cust-picker-label" id="label-ears">Orejas</label></div>
          </div>
        </div>

        <!-- 4. Ojos -->
        <div class="customizer-section">
          <h3>4. Ojos</h3>
          <div class="flex justify-around gap-2 mb-3">
            <button class="cust-preset-color" style="background: radial-gradient(circle, #E8F196, #95C23D);" onclick="CustomizerAPI.setEyeColor('#E8F196', '#95C23D', '#4A7314', '#0D0D0D')"></button>
            <button class="cust-preset-color" style="background: radial-gradient(circle, #A5E6FA, #4BADE5);" onclick="CustomizerAPI.setEyeColor('#A5E6FA', '#4BADE5', '#1F6895', '#0D0D0D')"></button>
            <button class="cust-preset-color" style="background: radial-gradient(circle, #FDEB9E, #E5A626);" onclick="CustomizerAPI.setEyeColor('#FDEB9E', '#E5A626', '#996311', '#0D0D0D')"></button>
            <button class="cust-preset-color" style="background: radial-gradient(circle, #FAD0C4, #F08080);" onclick="CustomizerAPI.setEyeColor('#FAD0C4', '#F08080', '#953434', '#0D0D0D')"></button>
            <button class="cust-preset-color" style="background: radial-gradient(circle, #DCD0FF, #9B5DE5);" onclick="CustomizerAPI.setEyeColor('#DCD0FF', '#9B5DE5', '#4A1D8A', '#0D0D0D')"></button>
          </div>
          <div class="border-t border-white/5 pt-3 flex justify-center gap-6">
            <div class="cust-picker-wrap"><input type="color" id="color-eye-main" value="#95C23D" oninput="CustomizerAPI.setColor('--eye-main', this.value); CustomizerAPI.setColor('--eye-light', this.value);"><label class="cust-picker-label">Iris</label></div>
            <div class="cust-picker-wrap"><input type="color" id="color-eye-dark" value="#4A7314" oninput="CustomizerAPI.setColor('--eye-dark', this.value)"><label class="cust-picker-label">Borde</label></div>
            <div class="cust-picker-wrap"><input type="color" id="color-eye-pupil" value="#0D0D0D" oninput="CustomizerAPI.setColor('--eye-pupil', this.value)"><label class="cust-picker-label">Pupila</label></div>
          </div>
        </div>

        <!-- 5. Cuello -->
        <div class="customizer-section">
          <h3>5. Cuello</h3>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-xs text-fg">Accesorio</span>
              <select id="acc-selector" onchange="CustomizerAPI.setAccessory(this.value)" class="cust-select">
                <option value="cascabel">Collar + Cascabel</option>
                <option value="placa">Collar + Placa</option>
                <option value="corazon">Collar + Corazon</option>
                <option value="corbatin">Collar + Corbatin</option>
                <option value="flor">Collar + Flor</option>
                <option value="estrella">Collar + Estrella</option>
                <option value="bufanda">Bufanda</option>
                <option value="ninguno">Sin Collar</option>
              </select>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-xs text-fg">Color</span>
              <div class="flex gap-2 items-center">
                <button class="cust-preset-color" style="background:#D33C37" onclick="CustomizerAPI.setCollarColor('#D33C37')"></button>
                <button class="cust-preset-color" style="background:#3B82F6" onclick="CustomizerAPI.setCollarColor('#3B82F6')"></button>
                <button class="cust-preset-color" style="background:#10B981" onclick="CustomizerAPI.setCollarColor('#10B981')"></button>
                <input type="color" id="color-collar" value="#D33C37" oninput="CustomizerAPI.setCollarColor(this.value)" class="cust-preset-color" style="padding:0;-webkit-appearance:none;border:none;">
              </div>
            </div>
          </div>
        </div>

        <!-- 6. Sombreros y Gafas -->
        <div class="customizer-section">
          <h3>6. Sombreros y Gafas</h3>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-xs text-fg">Gafas</span>
              <select id="glasses-selector" onchange="CustomizerAPI.setGlasses(this.value)" class="cust-select">
                <option value="none">Ningunas</option>
                <option value="round">Redondas</option>
                <option value="square">Cuadradas</option>
              </select>
              <input type="color" value="#1F2937" oninput="CustomizerAPI.setColor('--acc-glasses', this.value)" class="cust-preset-color" style="padding:0;-webkit-appearance:none;border:none;">
            </div>
            <div class="flex items-center justify-between border-t border-white/5 pt-3">
              <span class="text-xs text-fg">Sombrero</span>
              <select id="hat-selector" onchange="CustomizerAPI.setHat(this.value)" class="cust-select">
                <option value="none">Ninguno</option>
                <option value="gorro">Gorro</option>
                <option value="copa">Copa</option>
                <option value="fiesta">Fiesta</option>
              </select>
              <input type="color" value="#3B82F6" oninput="CustomizerAPI.setColor('--acc-hat', this.value)" class="cust-preset-color" style="padding:0;-webkit-appearance:none;border:none;">
            </div>
          </div>
        </div>

        <!-- Save/Reset -->
        <div class="flex gap-2 mt-4">
          <button onclick="CustomizerAPI.save()" class="flex-1 py-2.5 rounded-xl bg-accent text-bg text-xs font-bold hover:bg-accent2 transition btn-glow">Guardar</button>
          <button onclick="CustomizerAPI.reset()" class="flex-1 py-2.5 rounded-xl bg-white/5 text-fg text-xs font-bold hover:bg-white/10 transition border border-white/10">Reset</button>
        </div>
      </div>
    `;
  }

  // ============================================================
  // SPECIES SELECTION
  // ============================================================
  function selectSpecies(speciesKey) {
    currentSpecies = speciesKey;
    if (window.AvatarAPI) AvatarAPI.setSpecies(speciesKey);

    document.querySelectorAll('.species-btn').forEach(function(btn) {
      btn.classList.remove('active');
      if (btn.dataset.species === speciesKey) btn.classList.add('active');
    });

    var bContainer = document.getElementById('breed-container');
    if (bContainer) {
      bContainer.innerHTML = '';
      var breedsObj = animalDatabase[speciesKey].breeds;
      Object.keys(breedsObj).forEach(function(bKey) {
        var b = breedsObj[bKey];
        var btn = document.createElement('button');
        btn.innerText = b.name;
        btn.className = 'cust-btn breed-btn' + (b.isCustom ? ' active' : '');
        btn.dataset.breed = bKey;
        btn.onclick = function() { selectBreed(bKey); };
        bContainer.appendChild(btn);
      });
      selectBreed(Object.keys(breedsObj)[0]);
    }
    config.species = speciesKey;
  }

  // ============================================================
  // BREED SELECTION
  // ============================================================
  function selectBreed(breedKey) {
    currentBreed = breedKey;
    var breedData = animalDatabase[currentSpecies].breeds[breedKey];
    var defaultEars = breedData.ears || animalDatabase[currentSpecies].ears;
    if (window.AvatarAPI) AvatarAPI.setEars(defaultEars);
    config.ears = defaultEars;

    document.querySelectorAll('.breed-btn').forEach(function(btn) {
      btn.classList.remove('active');
      if (btn.dataset.breed === breedKey) btn.classList.add('active');
    });

    var varWrapper = document.getElementById('variation-wrapper');
    if (varWrapper) {
      varWrapper.style.display = breedData.isCustom ? 'none' : 'block';
      if (!breedData.isCustom) renderVariations(breedData);
    }
    applyVariation(breedData, 0);
  }

  function renderVariations(breedData) {
    var container = document.getElementById('variation-container');
    if (!container) return;
    container.innerHTML = '';
    breedData.variations.forEach(function(vari, index) {
      var btn = document.createElement('button');
      btn.innerText = vari.name;
      btn.className = 'cust-btn var-btn' + (index === 0 ? ' active' : '');
      btn.onclick = function() { applyVariation(breedData, index); };
      container.appendChild(btn);
    });
  }

  // ============================================================
  // APPLY VARIATION
  // ============================================================
  function applyVariation(breedData, variationIndex) {
    var vari = breedData.variations[variationIndex];
    if (window.AvatarAPI) AvatarAPI.showPattern(vari.id);

    // Apply preset colors
    if (window.AvatarAPI) {
      AvatarAPI.setColor('--cat-base', vari.preset.base);
      AvatarAPI.setColor('--cat-spot1', vari.preset.s1);
      AvatarAPI.setColor('--cat-spot2', vari.preset.s2);
      AvatarAPI.setColor('--cat-ears', vari.preset.ears);
      AvatarAPI.setEyeColor(vari.preset.eyeL, vari.preset.eyeM, vari.preset.eyeD, vari.preset.pupil);
    }

    // Update config
    config.pattern = vari.id;
    config.colors = { base: vari.preset.base, spot1: vari.preset.s1, spot2: vari.preset.s2, ears: vari.preset.ears };
    config.eyes = { light: vari.preset.eyeL, main: vari.preset.eyeM, dark: vari.preset.eyeD, pupil: vari.preset.pupil };

    // Update color picker visibility + labels
    ['base','spot1','spot2','ears'].forEach(function(picker) {
      var wrap = document.getElementById('wrap-' + picker);
      var label = document.getElementById('label-' + picker);
      if (wrap && label) {
        if (vari.activePickers.indexOf(picker) > -1) {
          wrap.style.display = 'flex';
          label.textContent = vari.labels[picker] || picker;
        } else {
          wrap.style.display = 'none';
        }
      }
    });

    // Sync color input values
    syncColorInputs(vari.preset);

    // Update active variation button
    document.querySelectorAll('.var-btn').forEach(function(btn, idx) {
      btn.classList.remove('active');
      if (idx === variationIndex) btn.classList.add('active');
    });
  }

  function syncColorInputs(preset) {
    var map = { 'color-base': preset.base, 'color-spot1': preset.s1, 'color-spot2': preset.s2, 'color-ears': preset.ears,
      'color-eye-main': preset.eyeM, 'color-eye-dark': preset.eyeD, 'color-eye-pupil': preset.pupil };
    Object.keys(map).forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = map[id];
    });
  }

  // ============================================================
  // COLOR HANDLERS
  // ============================================================
  function handleColorChange(type, value) {
    if (window.AvatarAPI) AvatarAPI.setColor('--cat-' + type, value);
    config.colors[type] = value;
  }

  function setColor(variable, value) {
    if (window.AvatarAPI) AvatarAPI.setColor(variable, value);
    if (variable === '--eye-main') { config.eyes.main = value; }
    if (variable === '--eye-dark') { config.eyes.dark = value; }
    if (variable === '--eye-pupil') { config.eyes.pupil = value; }
  }

  function setEyeColor(light, main, dark, pupil) {
    if (window.AvatarAPI) AvatarAPI.setEyeColor(light, main, dark, pupil);
    config.eyes = { light: light, main: main, dark: dark, pupil: pupil };
    var em = document.getElementById('color-eye-main'); if (em) em.value = main;
    var ed = document.getElementById('color-eye-dark'); if (ed) ed.value = dark;
    var ep = document.getElementById('color-eye-pupil'); if (ep) ep.value = pupil;
  }

  // ============================================================
  // ACCESSORIES
  // ============================================================
  function setAccessory(type) {
    if (window.AvatarAPI) AvatarAPI.setAccessory(type);
    config.accessory = type;
  }

  function setGlasses(type) {
    if (window.AvatarAPI) AvatarAPI.setGlasses(type);
    config.glasses = type;
  }

  function setHat(type) {
    if (window.AvatarAPI) AvatarAPI.setHat(type);
    config.hat = type;
  }

  function setCollarColor(value) {
    if (window.AvatarAPI) { AvatarAPI.setColor('--collar-band', value); AvatarAPI.setColor('--acc-scarf', value); }
    config.collar = value;
    var el = document.getElementById('color-collar'); if (el) el.value = value;
  }

  // ============================================================
  // PERSISTENCE
  // ============================================================
  function save() {
    try {
      localStorage.setItem('kali_avatar_config', JSON.stringify(config));
      if (window.showToast) showToast('Avatar guardado', 'ok');
    } catch(e) { if (window.showToast) showToast('Error al guardar', 'err'); }
  }

  function load() {
    try {
      var data = localStorage.getItem('kali_avatar_config');
      if (!data) return null;
      return JSON.parse(data);
    } catch(e) { return null; }
  }

  function reset() {
    localStorage.removeItem('kali_avatar_config');
    selectSpecies('gato');
    if (window.showToast) showToast('Avatar reseteado', 'info');
  }

  // ============================================================
  // DRAWER CONTROL
  // ============================================================
  function toggle() { isOpen ? close() : open(); }

  function open() {
    if (!drawerEl) return;
    drawerEl.classList.add('open');
    isOpen = true;
  }

  function close() {
    if (!drawerEl) return;
    drawerEl.classList.remove('open');
    isOpen = false;
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    drawerEl = document.getElementById('customizer-drawer');
    if (!drawerEl) return;
    drawerEl.innerHTML = getDrawerHTML();

    // Load saved config
    var saved = load();
    if (saved) {
      config = saved;
      // Apply to avatar
      if (window.AvatarAPI) AvatarAPI.applyConfig(saved);
      // Sync UI to config (species)
      if (saved.species) {
        selectSpecies(saved.species);
        // Sync breed if present
        if (saved.breed) selectBreed(saved.breed);
      }
      // Sync accessories
      if (saved.accessory) { var el = document.getElementById('acc-selector'); if (el) el.value = saved.accessory; }
      if (saved.glasses) { var el = document.getElementById('glasses-selector'); if (el) el.value = saved.glasses; }
      if (saved.hat) { var el = document.getElementById('hat-selector'); if (el) el.value = saved.hat; }
    } else {
      selectSpecies('gato');
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    init: init,
    toggle: toggle,
    open: open,
    close: close,
    save: save,
    reset: reset,
    selectSpecies: selectSpecies,
    selectBreed: selectBreed,
    handleColorChange: handleColorChange,
    setColor: setColor,
    setEyeColor: setEyeColor,
    setAccessory: setAccessory,
    setGlasses: setGlasses,
    setHat: setHat,
    setCollarColor: setCollarColor,
    getConfig: function() { return config; },
    animalDatabase: animalDatabase
  };
})();

window.CustomizerAPI = CustomizerAPI;