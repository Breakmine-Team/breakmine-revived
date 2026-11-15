export default class Keyboard {

    static state = {};
    static enabled = false;

    static TV_KEY_MAP = {
        4: 'Escape',        
        461: 'Escape',      
        10009: 'Escape',    
        403: 'ColorRed',    
        108: 'ColorRed',    
        404: 'ColorGreen',  
        20: 'ColorGreen',   
        405: 'ColorYellow', 
        21: 'ColorYellow',  
        406: 'ColorBlue',   
        22: 'ColorBlue',    
    };

    static TV_KEY_NAME_MAP = {
        'ColorF0Red': 'ColorRed',
        'Red': 'ColorRed',
        'ColorF1Green': 'ColorGreen',
        'Green': 'ColorGreen',
        'ColorF2Yellow': 'ColorYellow',
        'Yellow': 'ColorYellow',
        'ColorF3Blue': 'ColorBlue',
        'Blue': 'ColorBlue',
    };

    static mapKeyCode(event) {
        let code = Keyboard.TV_KEY_MAP[event.keyCode];
        if (code) {
            return code;
        }
        let nameCode = Keyboard.TV_KEY_NAME_MAP[event.key];
        if (nameCode) {
            return nameCode;
        }
        return event.code;
    }

    static isTextEntry(element) {
        return !!element && (element.tagName === 'INPUT'
            || element.tagName === 'TEXTAREA'
            || element.isContentEditable === true);
    }

    static create() {
        // Keys typed into a real text field (the IDE's editor, a launcher input)
        // are not game input: recording them made the player walk away while typing.
        window.addEventListener('keydown', event => {
            if (Keyboard.isTextEntry(event.target) || Keyboard.isTextEntry(document.activeElement)) {
                return;
            }
            let code = Keyboard.mapKeyCode(event);
            Keyboard.state[code] = true;
        });
        window.addEventListener('keyup', event => {
            if (Keyboard.isTextEntry(event.target) || Keyboard.isTextEntry(document.activeElement)) {
                return;
            }
            event.preventDefault();
            let code = Keyboard.mapKeyCode(event);
            delete Keyboard.state[code];
        });

        Keyboard.setEnabled(true);
    };

    static setState(key, state) {
        Keyboard.state[key] = state;
    }

    static unPressAll() {
        Keyboard.state = {};
    }

    static isKeyDown(key) {
        return Keyboard.state[key] && Keyboard.enabled;
    }

    
    static isShiftDown() {
        return !!(Keyboard.state["ShiftLeft"] || Keyboard.state["ShiftRight"]);
    }

    static setEnabled(enabled) {
        Keyboard.enabled = enabled;

        if (!enabled) {
            Keyboard.unPressAll();
        }
    }

}