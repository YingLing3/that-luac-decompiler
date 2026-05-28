function escapeLuaString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '\\0');
}

function luaString(value) {
  if (value === null || value === undefined) {
    return 'nil';
  }

  return `"${escapeLuaString(value)}"`;
}

function luaKey(value) {
  if (value === null || value === undefined) {
    return 'nil';
  }

  let normalized = value;
  if (typeof normalized === 'string' && normalized.startsWith('"') && normalized.endsWith('"')) {
    try {
      normalized = JSON.parse(normalized);
    } catch (error) {
      // Keep original value when it is not valid JSON.
    }
  }

  if (/^[A-Za-z_][A-Za-z_0-9]*$/.test(normalized)) {
    return normalized;
  }

  return `["${escapeLuaString(normalized)}"]`;
}

function luaNumber(value) {
  if (value === Infinity) {
    return '1/0';
  }

  if (value === -Infinity) {
    return '-1/0';
  }

  if (Number.isNaN(value)) {
    return '0/0';
  }

  return String(value);
}

function isIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z_0-9]*$/.test(value);
}

module.exports = {
  luaString,
  luaKey,
  luaNumber,
  isIdentifier,
};
