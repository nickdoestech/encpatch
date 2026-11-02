/**
 * companion-module-encpatch — main module entry point.
 *
 * This is the Bitfocus Companion side of the ENCpatch ↔ Companion bridge.
 * It speaks HTTP to ENCpatch's `/api/inject` endpoint, which lets a
 * Companion button trigger any of ENCpatch's mapping engine actions
 * (bridgeTick, setPage, cmd, multi). That means a Companion user can
 * drive an Eos / MA3 / Onyx / Titan / Hog / MagicQ / Vista console without
 * Companion knowing anything about the target — ENCpatch is the
 * abstraction layer.
 *
 * Configure: ENCpatch host (default 127.0.0.1), HTTP port (default 8733).
 *
 * Build/develop: `npm run dev` from this directory after `npm install`.
 * Companion will hot-reload during dev. To install in Companion proper,
 * place the built bundle in Companion's "developer modules" folder.
 */
'use strict';

const { InstanceBase, runEntrypoint, InstanceStatus, Regex } = require('@companion-module/base');

class EncpatchInstance extends InstanceBase {
  async init(config) {
    this.config = config;
    this._defineActions();
    this._defineVariables();
    this._defineFeedbacks();
    this.updateStatus(InstanceStatus.Ok, 'ready');
    // Don't probe on startup — many users keep ENCpatch running on a
    // separate machine and don't want a 5s warmup hang. We surface a
    // clear "unreachable" state from the first action invocation instead.
    // But DO start polling for state in the background.
    this._startStatePolling();
  }

  async destroy() {
    // Clean up polling
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  async configUpdated(config) {
    this.config = config;
  }

  getConfigFields() {
    return [
      {
        type: 'static-text',
        id: 'info',
        width: 12,
        label: 'About ENCpatch',
        value:
          'ENCpatch is the encoder-driven control patching desktop app. ' +
          'This module talks to its HTTP API. Default host:port is 127.0.0.1:8733.',
      },
      {
        type: 'textinput',
        id: 'host',
        label: 'ENCpatch host (IP)',
        width: 6,
        regex: Regex.IP,
        default: '127.0.0.1',
      },
      {
        type: 'textinput',
        id: 'port',
        label: 'ENCpatch HTTP port',
        width: 6,
        regex: Regex.PORT,
        default: '8733',
      },
    ];
  }

  _defineVariables() {
    // @companion-module/base v2 expects an object keyed by variableId
    // (v1 took an array of { name, variableId }).
    this.setVariableDefinitions({
      console_name: { name: 'Console name' },
      console_version: { name: 'Console version' },
      console_connected: { name: 'Console connected' },
    });
  }

  _defineFeedbacks() {
    this.setFeedbackDefinitions({
      console_connected: {
        type: 'boolean',
        name: 'Console connected',
        description: 'Turns the button green when the console is connected',
        defaultStyle: {
          bgcolor: 0x00aa00,
          color: 0xffffff,
        },
        callback: (feedback) => {
          return this._consoleConnected === true;
        },
      },
    });
  }

  _defineActions() {
    this.setActionDefinitions({
      bridgeTick: {
        name: 'Encoder tick (bridgeTick)',
        description: 'Send a relative encoder tick to the active console driver.',
        options: [
          { type: 'number', id: 'encoder', label: 'Encoder slot (1..4)', default: 1, min: 1, max: 4 },
          { type: 'number', id: 'delta',   label: 'Delta (negative = CCW)', default: 1, min: -100, max: 100 },
        ],
        callback: async (event) => {
          await this._inject({
            type: 'bridgeTick',
            encoder: Number(event.options.encoder) || 1,
            delta:   Number(event.options.delta)   || 1,
          });
        },
      },
      setPage: {
        name: 'Select encoder bank (setPage)',
        description: 'Switch the encoder bar to a feature bank by name.',
        options: [
          {
            type: 'dropdown',
            id: 'page',
            label: 'Bank',
            default: 'Dimmer',
            choices: [
              { id: 'Dimmer',   label: 'Dimmer'   },
              { id: 'Position', label: 'Position' },
              { id: 'Color',    label: 'Color'    },
              { id: 'Beam',     label: 'Beam'     },
              { id: 'Gobo',     label: 'Gobo'     },
              { id: 'Focus',    label: 'Focus'    },
              { id: 'Shapers',  label: 'Shapers'  },
              { id: 'Control',  label: 'Control'  },
            ],
          },
          { type: 'number', id: 'bankIdx', label: 'Bank index (1..8)', default: 1, min: 1, max: 8 },
        ],
        callback: async (event) => {
          await this._inject({
            type: 'setPage',
            page:    String(event.options.page || 'Dimmer'),
            bankIdx: Number(event.options.bankIdx) || 1,
          });
        },
      },
      cmd: {
        name: 'Console command line',
        description: 'Send a raw command-line string to whatever console ENCpatch is talking to.',
        options: [
          { type: 'textinput', id: 'text', label: 'Command', default: '', useVariables: true },
        ],
        callback: async (event) => {
          const text = await this.parseVariablesInString(event.options.text || '');
          await this._inject({ type: 'cmd', text });
        },
      },
    });
  }

  _startStatePolling() {
    // Poll every 2 seconds for console state
    this._pollInterval = setInterval(() => {
      this._pollState().catch((err) => {
        // Silently fail on poll errors — don't spam the log
      });
    }, 2000);
    // Also do an immediate poll
    this._pollState().catch(() => {});
  }

  async _pollState() {
    const url = `http://${this.config.host || '127.0.0.1'}:${this.config.port || 8733}/api/state`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        this._consoleConnected = false;
        this.setVariableValues({
          console_connected: 'false',
          console_name: 'unknown',
          console_version: 'unknown',
        });
        this.checkFeedbacks('console_connected');
        return;
      }
      const state = await resp.json();
      const connected = !!(state.console && state.console.connected);
      const name = (state.console && state.console.driver) ? state.console.driver : 'none';
      const version = state.version || 'unknown';

      this._consoleConnected = connected;
      this.setVariableValues({
        console_connected: connected ? 'true' : 'false',
        console_name: name,
        console_version: version,
      });
      this.checkFeedbacks('console_connected');
    } catch (err) {
      // Network error or JSON parse error
      this._consoleConnected = false;
      this.setVariableValues({
        console_connected: 'false',
        console_name: 'unreachable',
        console_version: 'unknown',
      });
      this.checkFeedbacks('console_connected');
    }
  }

  async _inject(action) {
    const url = `http://${this.config.host || '127.0.0.1'}:${this.config.port || 8733}/api/inject`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!resp.ok) {
        this.updateStatus(InstanceStatus.UnknownWarning, `inject HTTP ${resp.status}`);
      } else {
        this.updateStatus(InstanceStatus.Ok);
      }
    } catch (err) {
      this.updateStatus(InstanceStatus.ConnectionFailure, err && err.message);
    }
  }
}

runEntrypoint(EncpatchInstance, []);
