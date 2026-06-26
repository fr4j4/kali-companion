/* ============================================================
   SINGULARITY V7 — AVATAR MODULE
   SVG mascot injection + AvatarAPI (state, mood, speak)
   + mouse tracking + Web Audio synth
   ============================================================ */

const AvatarAPI = (function() {
  let svgEl = null, containerEl = null, headPivot = null;
  let pupilLeft = null, pupilRight = null;
  let stateIndicator = null, indicatorDot = null, indicatorText = null;
  let currentState = 'idle';
  let currentMood = 'normal';
  let audioCtx = null;
  let audioEnabled = true;
  let purrInterval = null;
  let speakTimer = null;
  let savedConfig = null;

  // ============================================================
  // SVG TEMPLATE (the full mascot SVG from pet-assist demo)
  // ============================================================
  const SVG_TEMPLATE = `
    <svg id="avatar-svg" data-state="idle" data-mood="normal" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">
      <defs>
        <radialGradient id="dynamic-iris" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="var(--eye-light)" />
          <stop offset="65%" stop-color="var(--eye-main)" />
          <stop offset="100%" stop-color="var(--eye-dark)" />
        </radialGradient>
        <filter id="blur-siamese" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="35"/>
        </filter>
      </defs>

      <g class="avatar-animate">
        <g id="head-pivot" class="head-tilt" data-animal="gato" data-ears="cat">

          <!-- ERIZO GEOMETRY -->
          <circle cx="500" cy="480" r="260" fill="var(--cat-base)" class="show-erizo" />
          <circle cx="500" cy="480" r="260" fill="none" stroke="var(--cat-spot2)" stroke-width="40" stroke-dasharray="1 60" stroke-linecap="round" class="show-erizo" />

          <!-- EARS INDEPENDENT -->
          <g class="ear-hedgehog left-ear" style="transform-origin: 280px 420px;">
            <circle cx="280" cy="420" r="35" fill="var(--cat-ears)" />
            <circle cx="290" cy="420" r="20" fill="#E6B8A2" />
          </g>
          <g class="ear-hedgehog right-ear" style="transform-origin: 720px 420px;">
            <circle cx="720" cy="420" r="35" fill="var(--cat-ears)" />
            <circle cx="710" cy="420" r="20" fill="#E6B8A2" />
          </g>

          <g class="ear-dog-up left-ear" style="transform-origin: 280px 370px;">
            <path d="M 280 400 L 160 180 C 140 140, 240 100, 300 180 L 400 350 Z" fill="var(--cat-ears)" stroke="var(--cat-ears)" stroke-width="4" stroke-linejoin="round"/>
            <path d="M 280 370 L 200 200 C 190 180, 240 160, 260 200 L 350 330 Z" fill="#F6A3A5" />
          </g>
          <g class="ear-dog-up right-ear" style="transform-origin: 720px 370px;">
            <path d="M 720 400 L 840 180 C 860 140, 760 100, 700 180 L 600 350 Z" fill="var(--cat-ears)" stroke="var(--cat-ears)" stroke-width="4" stroke-linejoin="round"/>
            <path d="M 720 370 L 800 200 C 810 180, 760 160, 740 200 L 650 330 Z" fill="#F6A3A5" />
          </g>

          <g class="ear-dog-flop left-ear" style="transform-origin: 250px 380px;">
            <path d="M 350 350 C 200 300, 100 420, 140 580 C 160 650, 260 650, 280 580 C 300 500, 320 420, 380 380 Z" fill="var(--cat-ears)" />
          </g>
          <g class="ear-dog-flop right-ear" style="transform-origin: 750px 380px;">
            <path d="M 650 350 C 800 300, 900 420, 860 580 C 840 650, 740 650, 720 580 C 700 500, 680 420, 620 380 Z" fill="var(--cat-ears)" />
          </g>

          <g class="ear-cat left-ear">
            <path d="M 255 365 L 290 145 C 295 125, 318 125, 328 145 L 420 310 Z" fill="var(--cat-ears)" stroke="var(--cat-ears)" stroke-width="4" stroke-linejoin="round" />
            <path d="M 275 345 L 302 175 C 305 165, 318 165, 322 175 L 390 300 Z" fill="#F6A3A5" />
          </g>
          <g class="ear-cat right-ear">
            <path d="M 745 365 L 710 145 C 705 125, 682 125, 672 145 L 580 310 Z" fill="var(--cat-ears)" stroke="var(--cat-ears)" stroke-width="4" stroke-linejoin="round" />
            <path d="M 725 345 L 698 175 C 695 165, 682 165, 678 175 L 610 300 Z" fill="#F6A3A5" />
          </g>

          <!-- FACES / MASKS -->
          <path id="head-base-erizo" d="M 380 350 C 450 300, 550 300, 620 350 C 700 400, 750 550, 650 680 C 600 750, 400 750, 350 680 C 250 550, 300 400, 380 350 Z" fill="var(--cat-base)" class="show-erizo" />

          <path id="head-base-dog" d="M 300 360 C 380 300, 620 300, 700 360 C 800 400, 850 500, 820 640 C 800 740, 650 760, 500 760 C 350 760, 200 740, 180 640 C 150 500, 200 400, 300 360 Z" fill="var(--cat-base)" class="show-perro" />
          <clipPath id="head-clip-dog">
            <path d="M 300 360 C 380 300, 620 300, 700 360 C 800 400, 850 500, 820 640 C 800 740, 650 760, 500 760 C 350 760, 200 740, 180 640 C 150 500, 200 400, 300 360 Z" />
          </clipPath>

          <path id="head-base-cat" d="M 270 360 C 350 300, 650 300, 730 360 C 810 380, 830 460, 830 580 C 830 690, 700 730, 500 730 C 300 730, 170 690, 170 580 C 170 460, 190 380, 270 360 Z" fill="var(--cat-base)" class="show-gato" />
          <clipPath id="head-clip-cat">
            <path d="M 270 360 C 350 300, 650 300, 730 360 C 810 380, 830 460, 830 580 C 830 690, 700 730, 500 730 C 300 730, 170 690, 170 580 C 170 460, 190 380, 270 360 Z" />
          </clipPath>

          <!-- CAT PATTERNS -->
          <g clip-path="url(#head-clip-cat)" class="show-gato">
            <g id="pattern-calico-1" class="hidden-pattern">
              <g fill="var(--cat-spot1)">
                <path d="M 150 400 C 150 300, 320 280, 420 320 C 390 420, 420 500, 380 580 C 320 660, 150 640, 150 400 Z" />
                <path d="M 850 500 C 850 650, 650 670, 570 590 C 580 510, 620 420, 730 370 C 780 410, 850 450, 850 500 Z" />
                <path d="M 390 615 C 390 575, 460 575, 460 615 C 460 645, 390 645, 390 615 Z" />
              </g>
              <path d="M 500 355 Q 530 440 570 555 L 430 555 Q 470 440 500 355 Z" fill="var(--cat-spot2)" stroke="var(--cat-spot2)" stroke-width="18" stroke-linejoin="round" />
            </g>
            <g id="pattern-calico-2" class="hidden-pattern">
              <g fill="var(--cat-spot1)">
                <path d="M 180 350 C 250 300, 350 400, 250 550 C 150 500, 100 400, 180 350 Z" />
                <circle cx="650" cy="650" r="45" /> <circle cx="280" cy="680" r="25" />
              </g>
              <g fill="var(--cat-spot2)">
                <path d="M 750 350 C 850 300, 850 500, 750 550 C 650 500, 650 400, 750 350 Z" />
                <circle cx="450" cy="350" r="30" />
                <path d="M 400 650 C 450 630, 500 680, 480 720 C 430 720, 380 680, 400 650 Z" />
              </g>
            </g>
            <g id="pattern-calico-3" class="hidden-pattern">
              <g fill="var(--cat-spot1)"><path d="M 200 350 C 350 300, 450 450, 400 550 C 300 650, 150 550, 200 350 Z" /></g>
              <g fill="var(--cat-spot2)"><path d="M 800 350 C 650 300, 550 450, 600 550 C 700 650, 850 550, 800 350 Z" /></g>
            </g>
            <g id="pattern-tabby-1" class="hidden-pattern">
              <g fill="none" stroke="var(--cat-spot2)" stroke-width="12" stroke-linecap="round">
                <path d="M 420 340 Q 435 430 450 460 M 450 460 Q 470 380 500 380 Q 530 380 550 460 M 550 460 Q 565 430 580 340" />
                <path d="M 465 290 L 465 340 M 535 290 L 535 340 M 500 270 L 500 340" />
                <path d="M 170 470 Q 240 480 290 470 M 150 520 Q 230 530 280 520 M 160 570 Q 220 580 260 570" />
                <path d="M 830 470 Q 760 480 710 470 M 850 520 Q 770 530 720 520 M 840 570 Q 780 580 740 570" />
              </g>
            </g>
            <g id="pattern-tabby-2" class="hidden-pattern">
              <g fill="none" stroke="var(--cat-spot2)" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">
                <path d="M 350 350 L 450 480" /> <path d="M 650 350 L 550 480" />
                <path d="M 500 280 L 500 400" /> <path d="M 430 280 L 480 380" /> <path d="M 570 280 L 520 380" />
                <path d="M 120 480 Q 260 490 300 470 M 110 560 Q 250 570 280 540" />
                <path d="M 880 480 Q 740 490 700 470 M 890 560 Q 750 570 720 540" />
              </g>
            </g>
            <g id="pattern-tabby-3" class="hidden-pattern">
              <g fill="none" stroke="var(--cat-spot2)" stroke-width="10" stroke-linecap="round">
                <path d="M 450 340 L 460 440 M 500 320 L 500 440 M 550 340 L 540 440" />
              </g>
              <g fill="var(--cat-spot2)">
                <circle cx="200" cy="480" r="12" /> <circle cx="250" cy="490" r="10" /> <circle cx="220" cy="530" r="15" />
                <circle cx="280" cy="560" r="8" /> <circle cx="180" cy="580" r="10" />
                <circle cx="800" cy="480" r="12" /> <circle cx="750" cy="490" r="10" /> <circle cx="780" cy="530" r="15" />
                <circle cx="720" cy="560" r="8" /> <circle cx="820" cy="580" r="10" />
              </g>
            </g>
            <g id="pattern-tuxedo-1" class="hidden-pattern">
              <path d="M 500 380 C 560 480, 680 550, 750 740 L 250 740 C 320 550, 440 480, 500 380 Z" fill="var(--cat-spot1)" />
              <ellipse cx="500" cy="620" rx="200" ry="110" fill="var(--cat-spot1)" />
            </g>
            <g id="pattern-siamese-1" class="hidden-pattern">
              <ellipse cx="500" cy="520" rx="260" ry="190" fill="var(--cat-spot2)" filter="url(#blur-siamese)" />
            </g>
          </g>

          <!-- DOG PATTERNS -->
          <g clip-path="url(#head-clip-dog)" class="show-perro">
            <g id="pattern-dog-shiba" class="hidden-pattern">
              <path d="M 500 200 C 650 200, 750 350, 750 550 C 750 650, 600 550, 500 520 C 400 550, 250 650, 250 550 C 250 350, 350 200, 500 200 Z" fill="var(--cat-spot1)" />
            </g>
            <g id="pattern-dog-husky" class="hidden-pattern">
              <path d="M 500 380 C 550 380, 600 320, 680 320 L 800 200 L 850 500 C 800 650, 650 550, 550 480 L 500 450 L 450 480 C 350 550, 200 650, 150 500 L 200 200 L 320 320 C 400 320, 450 380, 500 380 Z" fill="var(--cat-spot2)" />
            </g>
            <g id="pattern-dog-pug" class="hidden-pattern">
              <ellipse cx="500" cy="580" rx="140" ry="100" fill="var(--cat-spot2)" />
            </g>
            <g id="pattern-dog-dalmata" class="hidden-pattern">
              <g fill="var(--cat-spot2)">
                <circle cx="350" cy="350" r="30" /> <circle cx="650" cy="300" r="25" />
                <circle cx="200" cy="500" r="40" /> <circle cx="800" cy="550" r="35" />
                <circle cx="300" cy="650" r="20" /> <circle cx="680" cy="700" r="28" />
                <circle cx="500" cy="300" r="18" /> <circle cx="450" cy="400" r="12" />
              </g>
            </g>
            <g id="pattern-dog-tuxedo" class="hidden-pattern">
              <path d="M 500 380 C 560 480, 680 550, 750 740 L 250 740 C 320 550, 440 480, 500 380 Z" fill="var(--cat-spot1)" />
              <ellipse cx="500" cy="620" rx="200" ry="110" fill="var(--cat-spot1)" />
            </g>
          </g>

          <!-- SOLID PATTERN (shared) -->
          <g id="pattern-solid" class="hidden-pattern"></g>

          <!-- EYES + GLASSES -->
          <g id="eye-left" class="eyelid eyelid-left">
            <circle cx="355" cy="480" r="105" fill="url(#dynamic-iris)" stroke="#211E1F" stroke-width="1.5" />
            <g id="pupil-left-group" class="eye-shine">
              <ellipse cx="355" cy="480" rx="88" ry="88" fill="var(--eye-pupil)" class="pupil-core" style="transform-origin: 355px 480px" />
              <circle cx="325" cy="445" r="24" fill="#FFFFFF" class="shine-main" style="transform-origin: 325px 445px" />
              <circle cx="390" cy="510" r="10" fill="#FFFFFF" class="shine-sub" style="transform-origin: 390px 510px" />
            </g>
          </g>
          <g id="eye-right" class="eyelid eyelid-right">
            <circle cx="645" cy="480" r="105" fill="url(#dynamic-iris)" stroke="#211E1F" stroke-width="1.5" />
            <g id="pupil-right-group" class="eye-shine">
              <ellipse cx="645" cy="480" rx="88" ry="88" fill="var(--eye-pupil)" class="pupil-core" style="transform-origin: 645px 480px" />
              <circle cx="615" cy="445" r="24" fill="#FFFFFF" class="shine-main" style="transform-origin: 615px 445px" />
              <circle cx="680" cy="510" r="10" fill="#FFFFFF" class="shine-sub" style="transform-origin: 680px 510px" />
            </g>
          </g>

          <!-- GLASSES -->
          <g id="acc-glasses-group">
            <g id="glasses-round" style="display: none;">
              <circle cx="355" cy="480" r="120" fill="none" stroke="var(--acc-glasses)" stroke-width="15" />
              <circle cx="645" cy="480" r="120" fill="none" stroke="var(--acc-glasses)" stroke-width="15" />
              <line x1="475" y1="450" x2="525" y2="450" stroke="var(--acc-glasses)" stroke-width="15" stroke-linecap="round"/>
              <path d="M 235 450 L 150 400" fill="none" stroke="var(--acc-glasses)" stroke-width="15" stroke-linecap="round" />
              <path d="M 765 450 L 850 400" fill="none" stroke="var(--acc-glasses)" stroke-width="15" stroke-linecap="round" />
            </g>
            <g id="glasses-square" style="display: none;">
              <rect x="235" y="380" width="240" height="200" rx="20" fill="none" stroke="var(--acc-glasses)" stroke-width="15" />
              <rect x="525" y="380" width="240" height="200" rx="20" fill="none" stroke="var(--acc-glasses)" stroke-width="15" />
              <line x1="475" y1="450" x2="525" y2="450" stroke="var(--acc-glasses)" stroke-width="15" stroke-linecap="round"/>
              <path d="M 235 450 L 150 400" fill="none" stroke="var(--acc-glasses)" stroke-width="15" stroke-linecap="round" />
              <path d="M 765 450 L 850 400" fill="none" stroke="var(--acc-glasses)" stroke-width="15" stroke-linecap="round" />
            </g>
          </g>

          <!-- MOUTHS (cat) -->
          <g class="show-gato">
            <path d="M 488 568 C 488 564, 512 564, 512 568 C 512 576, 488 576, 488 568 Z" fill="#211E1F" stroke="#FFFFFF" stroke-width="3.5" stroke-linejoin="round" />
            <path class="mouth-closed transition-all duration-300" d="M 455 595 Q 477 612 500 584 Q 523 612 545 595" fill="none" stroke="#211E1F" stroke-width="7.5" stroke-linecap="round" />
            <g class="mouth-opened transition-opacity duration-200" opacity="0">
              <path d="M 465 600 C 465 585, 535 585, 535 600 C 535 650, 465 650, 465 600 Z" fill="#501618" stroke="#211E1F" stroke-width="6" />
              <path d="M 478 622 C 478 610, 522 610, 522 622 C 522 645, 478 645, 478 622 Z" fill="#FF8C94" />
              <polygon points="476,594 484,606 490,594" fill="#FFFFFF" />
              <polygon points="524,594 516,606 510,594" fill="#FFFFFF" />
              <path d="M 465 598 C 455 600, 448 608, 448 618" fill="none" stroke="#211E1F" stroke-width="6.5" stroke-linecap="round" />
              <path d="M 535 598 C 545 598, 552 608, 552 618" fill="none" stroke="#211E1F" stroke-width="6.5" stroke-linecap="round" />
            </g>
          </g>

          <!-- MOUTHS (dog) -->
          <g class="show-perro">
            <path d="M 470 560 C 470 540, 530 540, 530 560 C 530 585, 500 595, 500 595 C 500 595, 470 585, 470 560 Z" fill="#211E1F" />
            <ellipse cx="490" cy="555" rx="8" ry="4" fill="#FFFFFF" opacity="0.6" transform="rotate(-15, 490, 555)" />
            <path class="mouth-closed transition-all duration-300" d="M 500 595 L 500 620 M 500 620 Q 460 630 440 600 M 500 620 Q 540 630 560 600" fill="none" stroke="#211E1F" stroke-width="7" stroke-linecap="round" />
            <g class="mouth-opened transition-opacity duration-200" opacity="0">
              <path d="M 450 610 Q 500 680 550 610 Z" fill="#501618" />
              <path d="M 470 630 C 470 680, 530 680, 530 630 Z" fill="#FF8C94" />
              <line x1="500" y1="630" x2="500" y2="660" stroke="#E05A69" stroke-width="3" stroke-linecap="round" />
              <path d="M 500 595 L 500 610 M 500 610 Q 460 620 440 600 M 500 610 Q 540 620 560 600" fill="none" stroke="#211E1F" stroke-width="7" stroke-linecap="round" />
            </g>
          </g>

          <!-- MOUTHS (hedgehog) -->
          <g class="show-erizo">
            <ellipse cx="500" cy="600" rx="45" ry="30" fill="var(--cat-spot1)" />
            <circle cx="500" cy="585" r="12" fill="#211E1F" />
            <path class="mouth-closed transition-all duration-300" d="M 485 615 Q 500 625 515 615" fill="none" stroke="#211E1F" stroke-width="5" stroke-linecap="round" />
            <g class="mouth-opened transition-opacity duration-200" opacity="0">
              <circle cx="500" cy="615" r="10" fill="#501618" />
            </g>
          </g>

          <!-- WHISKERS (cat only) -->
          <g class="show-gato left-whiskers">
            <path d="M 290 590 Q 200 575 110 590 Q 200 583 290 592 Z" fill="#211E1F" />
            <path d="M 280 615 Q 180 615 90 645 Q 180 623 280 622 Z" fill="#211E1F" />
            <path d="M 290 640 Q 190 655 110 700 Q 190 665 290 650 Z" fill="#211E1F" />
          </g>
          <g class="show-gato right-whiskers">
            <path d="M 710 590 Q 800 575 890 590 Q 800 583 710 592 Z" fill="#211E1F" />
            <path d="M 720 615 Q 820 615 910 645 Q 820 623 720 622 Z" fill="#211E1F" />
            <path d="M 710 640 Q 810 655 890 700 Q 810 665 710 650 Z" fill="#211E1F" />
          </g>

          <!-- NECK ACCESSORIES -->
          <g id="neck-accessories">
            <g id="base-collar-path">
              <path class="show-gato show-perro" d="M 270 705 C 350 750, 650 750, 730 705" fill="none" stroke="var(--collar-band)" stroke-width="26" stroke-linecap="round" />
              <path class="show-erizo" d="M 350 685 C 420 720, 580 720, 650 685" fill="none" stroke="var(--collar-band)" stroke-width="20" stroke-linecap="round" />
            </g>
            <g id="acc-scarf" style="display: none;">
              <path class="show-gato show-perro" d="M 230 680 C 350 780, 650 780, 770 680 C 780 730, 650 830, 350 830 C 250 810, 220 730, 230 680 Z" fill="var(--acc-scarf)" />
              <path class="show-erizo" d="M 320 660 C 400 730, 600 730, 680 660 C 690 710, 600 780, 400 780 C 320 760, 300 710, 320 660 Z" fill="var(--acc-scarf)" />
              <path d="M 600 740 C 650 780, 630 880, 650 930 C 700 920, 720 850, 700 730 Z" fill="var(--acc-scarf)" />
              <path d="M 600 740 C 650 780, 630 880, 650 930 C 700 920, 720 850, 700 730 Z" fill="none" stroke="#000000" stroke-width="5" opacity="0.15"/>
            </g>
            <g id="acc-cascabel" class="accessory-group" style="display: none;">
              <rect x="494" y="744" width="12" height="18" fill="#E0B345" rx="3" />
              <circle cx="500" cy="778" r="34" fill="#E0B345" stroke="#B88A1D" stroke-width="3" />
              <circle cx="488" cy="764" r="9" fill="#FFF" opacity="0.35" />
              <line x1="468" y1="781" x2="532" y2="781" stroke="#5E4304" stroke-width="5" stroke-linecap="round" />
              <circle cx="500" cy="796" r="7" fill="#5E4304" />
              <line x1="500" y1="781" x2="500" y2="789" stroke="#5E4304" stroke-width="4" />
            </g>
            <g id="acc-placa" class="accessory-group" style="display: none;">
              <rect x="494" y="744" width="12" height="15" fill="#CCCCCC" rx="3" />
              <circle cx="500" cy="775" r="28" fill="#FFD700" stroke="#E6BE00" stroke-width="3" />
              <path d="M 485 770 L 515 770 M 485 780 L 515 780" stroke="#B38F00" stroke-width="3" stroke-linecap="round" />
            </g>
            <g id="acc-corazon" class="accessory-group" style="display: none;">
              <rect x="494" y="744" width="12" height="15" fill="#CCCCCC" rx="3" />
              <path d="M 500 795 C 500 795, 470 770, 470 758 A 12 12 0 0 1 500 748 A 12 12 0 0 1 530 758 C 530 770, 500 795, 500 795 Z" fill="#F43F5E" stroke="#BE123C" stroke-width="3" />
            </g>
            <g id="acc-corbatin" class="accessory-group" style="display: none;">
              <polygon points="500,755 440,730 445,785" fill="var(--collar-band)" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"/>
              <polygon points="500,755 560,730 555,785" fill="var(--collar-band)" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"/>
              <path d="M 485 765 L 460 810 L 485 805 Z" fill="var(--collar-band)" />
              <path d="M 515 765 L 540 810 L 515 805 Z" fill="var(--collar-band)" />
              <circle cx="500" cy="758" r="14" fill="var(--collar-band)" stroke="#FFFFFF" stroke-width="3" />
            </g>
            <g id="acc-flor" class="accessory-group" style="display: none;">
              <rect x="494" y="744" width="12" height="15" fill="#CCCCCC" rx="3" />
              <circle cx="482" cy="770" r="15" fill="#F472B6" />
              <circle cx="518" cy="770" r="15" fill="#F472B6" />
              <circle cx="500" cy="752" r="15" fill="#F472B6" />
              <circle cx="491" cy="788" r="15" fill="#F472B6" />
              <circle cx="509" cy="788" r="15" fill="#F472B6" />
              <circle cx="500" cy="773" r="11" fill="#FBBF24" />
            </g>
            <g id="acc-estrella" class="accessory-group" style="display: none;">
              <rect x="494" y="744" width="12" height="15" fill="#CCCCCC" rx="3" />
              <circle cx="500" cy="775" r="26" fill="#FBBF24" stroke="#D97706" stroke-width="3" />
              <polygon points="500,758 506,770 519,771 509,780 512,793 500,785 488,793 491,780 481,771 494,770" fill="#FFFFFF" />
            </g>
          </g>

          <!-- HATS -->
          <g id="acc-hats">
            <g id="hat-gorro" style="display: none;">
              <path d="M 380 320 C 380 100, 620 100, 620 320 Z" fill="var(--acc-hat)" />
              <rect x="350" y="300" width="300" height="50" rx="15" fill="var(--acc-hat)" opacity="0.85" />
              <circle cx="500" cy="120" r="35" fill="var(--cat-spot1)" />
            </g>
            <g id="hat-copa" style="display: none;">
              <rect x="330" y="280" width="340" height="25" rx="10" fill="var(--acc-hat)" />
              <path d="M 380 280 L 400 80 L 600 80 L 620 280 Z" fill="var(--acc-hat)" />
              <rect x="390" y="240" width="220" height="40" fill="var(--collar-band)" />
            </g>
            <g id="hat-fiesta" style="display: none;">
              <path d="M 420 300 L 500 80 L 580 300 Z" fill="var(--acc-hat)" />
              <circle cx="500" cy="80" r="25" fill="var(--cat-spot1)" />
              <circle cx="500" cy="160" r="15" fill="var(--cat-spot1)" opacity="0.5"/>
              <circle cx="470" cy="220" r="15" fill="var(--cat-spot1)" opacity="0.5"/>
              <circle cx="530" cy="250" r="15" fill="var(--cat-spot1)" opacity="0.5"/>
            </g>
          </g>

        </g>
      </g>
    </svg>
  `;

  // ============================================================
  // AUDIO SYNTH
  // ============================================================
  function initAudio() {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { audioCtx = null; }
  }

  function playSynth(freq, dur, type, vol, dbl) {
    if (!audioEnabled || !audioCtx || audioCtx.state === 'suspended') return;
    type = type || 'sine'; vol = vol || 0.1;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + dur);
      if (dbl) setTimeout(function() { playSynth(freq * 1.2, dur, type, vol); }, 120);
    } catch(e) {}
  }

  function playPurr() {
    if (purrInterval) clearInterval(purrInterval);
    if (!svgEl || svgEl.getAttribute('data-mood') !== 'ronroneando') return;
    var p = function() {
      playSynth(85, 0.2, 'triangle', 0.15);
      setTimeout(function() { playSynth(60, 0.15, 'sine', 0.15); }, 100);
    };
    p();
    purrInterval = setInterval(function() {
      if (!svgEl || svgEl.getAttribute('data-mood') !== 'ronroneando') clearInterval(purrInterval);
      else p();
    }, 250);
  }

  // ============================================================
  // COLOR HELPERS
  // ============================================================
  function setColor(variable, value) {
    document.documentElement.style.setProperty(variable, value);
  }

  function setEyeColor(light, main, dark, pupil) {
    setColor('--eye-light', light);
    setColor('--eye-main', main);
    setColor('--eye-dark', dark);
    if (pupil) setColor('--eye-pupil', pupil);
  }

  // Pattern management
  var allSvgPatterns = [
    'pattern-calico-1', 'pattern-calico-2', 'pattern-calico-3',
    'pattern-tabby-1', 'pattern-tabby-2', 'pattern-tabby-3',
    'pattern-tuxedo-1', 'pattern-siamese-1',
    'pattern-dog-shiba', 'pattern-dog-husky', 'pattern-dog-pug',
    'pattern-dog-dalmata', 'pattern-dog-tuxedo', 'pattern-solid'
  ];

  function showPattern(patternId) {
    allSvgPatterns.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.classList.remove('visible-pattern'); el.classList.add('hidden-pattern'); }
    });
    var el = document.getElementById(patternId);
    if (el) { el.classList.remove('hidden-pattern'); el.classList.add('visible-pattern'); }
  }

  // Accessory management
  function setAccessory(type) {
    var accs = ['acc-cascabel', 'acc-placa', 'acc-corazon', 'acc-corbatin', 'acc-flor', 'acc-estrella', 'acc-scarf'];
    accs.forEach(function(acc) { var el = document.getElementById(acc); if (el) el.style.display = 'none'; });
    var baseCollar = document.getElementById('base-collar-path');
    if (baseCollar) baseCollar.style.display = 'block';
    if (type === 'bufanda') {
      if (baseCollar) baseCollar.style.display = 'none';
      var el = document.getElementById('acc-scarf'); if (el) el.style.display = 'block';
    } else if (type !== 'ninguno') {
      var el = document.getElementById('acc-' + type); if (el) el.style.display = 'block';
    } else {
      if (baseCollar) baseCollar.style.display = 'none';
    }
  }

  function setGlasses(type) {
    ['glasses-round', 'glasses-square'].forEach(function(g) {
      var el = document.getElementById(g); if (el) el.style.display = 'none';
    });
    if (type !== 'none') { var el = document.getElementById('glasses-' + type); if (el) el.style.display = 'block'; }
  }

  function setHat(type) {
    ['hat-gorro', 'hat-copa', 'hat-fiesta'].forEach(function(h) {
      var el = document.getElementById(h); if (el) el.style.display = 'none';
    });
    if (type !== 'none') { var el = document.getElementById('hat-' + type); if (el) el.style.display = 'block'; }
  }

  function setSpecies(speciesKey) {
    if (headPivot) headPivot.setAttribute('data-animal', speciesKey);
  }

  function setEars(earType) {
    if (headPivot) headPivot.setAttribute('data-ears', earType);
  }

  // ============================================================
  // STATE + MOOD MANAGEMENT
  // ============================================================
  function updateIndicator() {
    if (!indicatorDot || !indicatorText) return;
    indicatorDot.className = 'dot ' + currentState;
    var labels = { idle: 'Idle', escuchando: 'Escuchando', pensando: 'Pensando', hablando: 'Hablando' };
    indicatorText.textContent = labels[currentState] || currentState;
  }

  function setState(state) {
    currentState = state;
    if (svgEl) svgEl.setAttribute('data-state', state);
    updateIndicator();

    if (state !== 'pensando') {
      if (pupilLeft) pupilLeft.style.transform = '';
      if (pupilRight) pupilRight.style.transform = '';
      if (headPivot) headPivot.style.transform = '';
    }
    if (state === 'escuchando') playSynth(600, 0.1, 'sine', 0.1, true);
    if (state === 'pensando') playSynth(300, 0.05, 'triangle', 0.05);

    if (state === 'hablando') {
      document.querySelectorAll('#avatar-svg .mouth-closed').forEach(function(el) { el.setAttribute('opacity', '0'); });
    } else {
      document.querySelectorAll('#avatar-svg .mouth-closed').forEach(function(el) { el.removeAttribute('opacity'); });
    }
  }

  function setMood(mood) {
    currentMood = mood;
    if (svgEl) svgEl.setAttribute('data-mood', mood);
    if (mood === 'enojado') playSynth(150, 0.3, 'sawtooth', 0.1);
    if (mood === 'sorprendido') playSynth(800, 0.15, 'sine', 0.1);
    if (mood === 'ronroneando') playPurr();
  }

  // ============================================================
  // SPEAK
  // ============================================================
  function speak(text, duration) {
    if (!text) return;
    duration = duration || Math.max(2000, text.length * 100);
    setState('hablando');
    if (speakTimer) clearTimeout(speakTimer);
    speakTimer = setTimeout(function() {
      setState('idle');
      setMood('normal');
    }, duration);
  }

  // ============================================================
  // MOUSE TRACKING
  // ============================================================
  function initMouseTracking() {
    document.addEventListener('mousemove', function(e) {
      if (!svgEl || svgEl.getAttribute('data-state') === 'pensando') return;
      var rect = svgEl.getBoundingClientRect();
      if (rect.width === 0) return;
      var relX = (e.clientX - rect.left) / rect.width;
      var relY = (e.clientY - rect.top) / rect.height;
      var maxOffset = 18, maxHeadRot = 10, maxHeadTx = 22, maxHeadTy = 14;
      var dx = (relX - 0.5) * 2, dy = (relY - 0.5) * 2;
      var distance = Math.sqrt(dx * dx + dy * dy);
      var factor = distance > 1 ? 1 / distance : 1;
      if (pupilLeft) pupilLeft.style.transform = 'translate(' + (dx * factor * maxOffset) + 'px, ' + (dy * factor * maxOffset) + 'px)';
      if (pupilRight) pupilRight.style.transform = 'translate(' + (dx * factor * maxOffset) + 'px, ' + (dy * factor * maxOffset) + 'px)';
      if (headPivot) headPivot.style.transform = 'translate(' + (dx * factor * maxHeadTx) + 'px, ' + (dy * factor * maxHeadTy) + 'px) rotate(' + (dx * factor * maxHeadRot) + 'deg)';
    });

    document.addEventListener('mouseleave', function() {
      if (!svgEl || svgEl.getAttribute('data-state') === 'pensando') return;
      if (pupilLeft) pupilLeft.style.transform = 'translate(0, 0)';
      if (pupilRight) pupilRight.style.transform = 'translate(0, 0)';
      if (headPivot) headPivot.style.transform = 'translate(0, 0) rotate(0deg)';
    });
  }

  // ============================================================
  // CLICK INTERACTION (pet / cycle states)
  // ============================================================
  var stateCycle = ['idle', 'escuchando', 'pensando', 'hablando'];
  var cycleIdx = 0;

  function initClick() {
    if (!containerEl) return;
    containerEl.addEventListener('click', function() {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      // Pet: brief surprise then cycle state
      var oldMood = currentMood;
      setMood('sorprendido');
      setTimeout(function() {
        setMood(oldMood);
        cycleIdx = (cycleIdx + 1) % stateCycle.length;
        setState(stateCycle[cycleIdx]);
      }, 800);
    });
  }

  // ============================================================
  // CONFIG (save/load/apply)
  // ============================================================
  function getConfig() {
    return savedConfig || {};
  }

  function applyConfig(config) {
    if (!config) return;
    savedConfig = config;
    if (config.species) setSpecies(config.species);
    if (config.ears) setEars(config.ears);
    if (config.pattern) showPattern(config.pattern);
    if (config.colors) {
      if (config.colors.base) setColor('--cat-base', config.colors.base);
      if (config.colors.spot1) setColor('--cat-spot1', config.colors.spot1);
      if (config.colors.spot2) setColor('--cat-spot2', config.colors.spot2);
      if (config.colors.ears) setColor('--cat-ears', config.colors.ears);
    }
    if (config.eyes) setEyeColor(config.eyes.light, config.eyes.main, config.eyes.dark, config.eyes.pupil);
    if (config.accessory) setAccessory(config.accessory);
    if (config.glasses) setGlasses(config.glasses);
    if (config.hat) setHat(config.hat);
    if (config.collar) { setColor('--collar-band', config.collar); setColor('--acc-scarf', config.collar); }
    if (config.hatColor) setColor('--acc-hat', config.hatColor);
    if (config.glassesColor) setColor('--acc-glasses', config.glassesColor);
  }

  // ============================================================
  // GET CENTER (for tethers)
  // ============================================================
  function getCenter() {
    if (!containerEl) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var rect = containerEl.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function setAudioEnabled(enabled) { audioEnabled = enabled; }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    containerEl = document.getElementById('avatar-container');
    if (!containerEl) return;
    containerEl.innerHTML = SVG_TEMPLATE;
    svgEl = document.getElementById('avatar-svg');
    headPivot = document.getElementById('head-pivot');
    pupilLeft = document.getElementById('pupil-left-group');
    pupilRight = document.getElementById('pupil-right-group');

    // State indicator
    stateIndicator = document.getElementById('avatar-state-indicator');
    if (stateIndicator) {
      indicatorDot = stateIndicator.querySelector('.dot');
      indicatorText = stateIndicator.querySelector('.indicator-text');
      stateIndicator.classList.add('visible');
    }

    initAudio();
    initMouseTracking();
    initClick();
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    init: init,
    setState: setState,
    setMood: setMood,
    speak: speak,
    getCenter: getCenter,
    getState: function() { return currentState; },
    getMood: function() { return currentMood; },
    setAudioEnabled: setAudioEnabled,
    // Visual config (used by customizer)
    applyConfig: applyConfig,
    getConfig: getConfig,
    // Low-level visual controls (used by customizer)
    setSpecies: setSpecies,
    setEars: setEars,
    showPattern: showPattern,
    setColor: setColor,
    setEyeColor: setEyeColor,
    setAccessory: setAccessory,
    setGlasses: setGlasses,
    setHat: setHat,
    allSvgPatterns: allSvgPatterns,
    svgEl: function() { return svgEl; }
  };
})();

window.AvatarAPI = AvatarAPI;