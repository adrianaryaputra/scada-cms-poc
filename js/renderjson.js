// js/renderjson.js
// Copyright (C) 2013 David Caldwell <david@porkrind.org>
// MIT License
// Restructured for ES6 module export and clarity.

const T_ARRAY = "array";
const T_OBJECT = "object";
const T_STRING = "string";
const T_NUMBER = "number";
const T_BOOLEAN = "boolean";
const T_NULL = "null"; // Added for clarity, though renderjson treats it as string "null"
const T_UNDEFINED = "undefined";

let 옵션_show_to_level = 1; // Default show_to_level, using a different name to avoid conflict if original is loaded
let 옵션_max_string_length = 0; // 0 for no limit
let 옵션_sort_objects = false;
// Replacers not implemented in this simplified version

function dispatch(path, value, depth) {
    if (value === null) return item(T_NULL, path, "null", depth); // Explicitly handle null
    switch (typeof(value)) {
        case T_STRING:
            let val = value;
            if (옵션_max_string_length && val.length > 옵션_max_string_length)
                val = val.slice(0, 옵션_max_string_length) + "…";
            return item(T_STRING, path, "\"" + val + "\"", depth);
        case T_NUMBER: return item(T_NUMBER, path, value, depth);
        case T_BOOLEAN: return item(T_BOOLEAN, path, value, depth);
        case T_OBJECT: // typeof null is "object", so null check above is important
            if (Array.isArray(value)) return arr(path, value, depth);
            else return obj(path, value, depth);
        default: return item(T_UNDEFINED, path, String(value), depth); // undefined and others
    }
}

function item(type, path, valueText, depth) {
    const li = document.createElement("li");
    const valueElement = document.createElement("span");
    valueElement.className = `rdjson-value rdjson-${type}`;
    valueElement.appendChild(document.createTextNode(valueText));
    li.appendChild(valueElement);
    return li;
}

function arr(path, value, depth) {
    const expandable_li = document.createElement("li");
    const exp = document.createElement("span");
    exp.className = "rdjson-expander";
    
    const ol = document.createElement("ol");
    ol.className="rdjson-array";
    ol.setAttribute("data-rdjson-path", path.join("."));
    
    if (depth >= 옵션_show_to_level || value.length === 0) {
        ol.classList.add("rdjson-hidden");
        exp.textContent = `[+] (${value.length})`;
    } else {
        exp.textContent = "[-]";
    }
    
    if (value.length === 0) {
         const emptyMsg = document.createElement("span");
         emptyMsg.className = "rdjson-empty";
         emptyMsg.textContent = "(empty array)";
         ol.appendChild(emptyMsg);
    } else {
        for (let i=0; i<value.length; i++) {
            const subPath = path.concat([String(i)]);
            const item_li = document.createElement("li");
            const index_span = document.createElement("span");
            index_span.className = "rdjson-key rdjson-index"; 
            index_span.textContent = i + ": ";
            item_li.appendChild(index_span);
            item_li.appendChild(dispatch(subPath, value[i], depth + 1).firstChild); 
            ol.appendChild(item_li);
        }
    }

    exp.addEventListener("click", function(e) {
        ol.classList.toggle("rdjson-hidden");
        this.textContent = ol.classList.contains("rdjson-hidden") ? `[+] (${value.length})` : "[-]";
        e.stopPropagation();
    });

    expandable_li.appendChild(exp);
    expandable_li.appendChild(ol);
    return expandable_li;
}

function obj(path, value, depth) {
    const expandable_li = document.createElement("li");
    const exp = document.createElement("span");
    exp.className = "rdjson-expander";

    const ul = document.createElement("ul");
    ul.className="rdjson-object";
    ul.setAttribute("data-rdjson-path", path.join("."));

    let keys = Object.keys(value);
    if (옵션_sort_objects) keys = keys.sort();

    if (depth >= 옵션_show_to_level || keys.length === 0) {
        ul.classList.add("rdjson-hidden");
        exp.textContent = `{+} (${keys.length})`;
    } else {
        exp.textContent = "{-}";
    }
    
    if (keys.length === 0) {
        const emptyMsg = document.createElement("span");
        emptyMsg.className = "rdjson-empty";
        emptyMsg.textContent = "(empty object)";
        ul.appendChild(emptyMsg);
    } else {
        for (let i=0; i<keys.length; i++) {
            const k = keys[i];
            const subPath = path.concat([k]);
            const li = document.createElement("li");
            const keyElement = document.createElement("span");
            keyElement.className = "rdjson-key";
            keyElement.textContent = "\"" + k + "\": ";
            li.appendChild(keyElement);
            li.appendChild(dispatch(subPath, value[k], depth + 1).firstChild); 
            ul.appendChild(li);
        }
    }
    
    exp.addEventListener("click", function(e) {
        ul.classList.toggle("rdjson-hidden");
        this.textContent = ul.classList.contains("rdjson-hidden") ? `{+} (${keys.length})` : "{-}";
        e.stopPropagation();
    });
    
    expandable_li.appendChild(exp);
    expandable_li.appendChild(ul);
    return expandable_li;
}

// Main function that will be exported
const renderjson = function(json) {
    const root_li = dispatch([], json, 0); 
    const container = document.createElement("div");
    container.className = "renderjson"; // Root container gets this class
    
    // Append children of root_li (expander and ol/ul or value span)
    while (root_li.firstChild) {
        container.appendChild(root_li.firstChild);
    }
    
    return container;
};

// Attach methods to the main renderjson function object
renderjson.set_icons = function(icon1, icon2) { 
    // console.warn("renderjson.set_icons is not fully implemented in this version.");
    return renderjson; 
};
renderjson.set_show_to_level = function(level) { 
    옵션_show_to_level = (typeof level === T_STRING && level.toLowerCase() === "all") 
        ? Number.MAX_VALUE 
        : parseInt(level, 10); 
    // console.log("renderjson: show_to_level set to", 옵션_show_to_level);
    return renderjson; 
};
renderjson.set_max_string_length = function(length) { 
    옵션_max_string_length = (typeof length === T_STRING && length.toLowerCase() === "all") 
        ? 0 
        : parseInt(length, 10); 
    return renderjson; 
};
renderjson.set_sort_objects = function(sort) { 
    옵션_sort_objects = sort; 
    return renderjson; 
};
renderjson.add_replacer = function(path, depth, element) { 
    // console.warn("renderjson.add_replacer is not implemented in this version.");
    return renderjson; 
};

export default renderjson;
