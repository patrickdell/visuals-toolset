/**
 * app.js — tab routing and shared ratio state
 */

import { PRESETS, initCalculator } from './calculator.js';
import { initCropper }             from './cropper.js';
import { initExporter }            from './exporter.js';

// ── Build preset chips ────────────────────────────────────────────────────

let activePreset = PRESETS[0];

function buildChips(container, onSelect) {
  PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'chip' + (preset === activePreset ? ' active' : '');
    btn.textContent = preset.label;
    btn.addEventListener('click', () => onSelect(preset));
    container.appendChild(btn);
  });
  return container;
}

function syncChips(container, preset) {
  container.querySelectorAll('.chip').forEach((btn, i) => {
    btn.classList.toggle('active', PRESETS[i] === preset);
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────

const tabBtns   = document.querySelectorAll('.tab-btn');
const panelCalc = document.getElementById('panel-calc');
const panelCrop = document.getElementById('panel-crop');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    panelCalc.classList.toggle('visible', tab === 'calc');
    panelCrop.classList.toggle('visible', tab === 'crop');
    localStorage.setItem('ar_tab', tab);
  });
});

// ── Init modules ──────────────────────────────────────────────────────────

const calcChips = document.getElementById('calcChips');
const cropChips = document.getElementById('cropChips');

const calculator = initCalculator({ onRatioChange: () => {} });
const cropper    = initCropper({ onCropChange: () => exporter.setEnabled(cropper.isLoaded()) });
const exporter   = initExporter({ getCropState: () => cropper.getCropState() });

exporter.setEnabled(false);

// ── Build chips for both panels ───────────────────────────────────────────

function selectRatio(preset) {
  activePreset = preset;
  syncChips(calcChips, preset);
  syncChips(cropChips, preset);
  calculator.setPreset(preset);
  cropper.setRatio(preset);
  localStorage.setItem('ar_preset', preset.label);
}

buildChips(calcChips, selectRatio);
buildChips(cropChips, selectRatio);

// ── Restore persisted state ───────────────────────────────────────────────

const savedPreset = localStorage.getItem('ar_preset');
if (savedPreset) {
  const found = PRESETS.find(p => p.label === savedPreset);
  if (found) selectRatio(found);
} else {
  selectRatio(activePreset);
}

const savedTab = localStorage.getItem('ar_tab') || 'calc';
const savedTabBtn = document.querySelector('.tab-btn[data-tab="' + savedTab + '"]');
if (savedTabBtn) savedTabBtn.click();
else document.querySelector('.tab-btn[data-tab="calc"]').click();
