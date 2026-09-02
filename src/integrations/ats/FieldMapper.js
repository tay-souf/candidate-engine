/**
 * Field Mapper
 * 
 * Maps standard Candidate Engine fields to specific ATS fields dynamically
 * based on the client's configuration.
 */
export default class FieldMapper {
  constructor(clientFieldMapping) {
    // Expected format: { "engine_field": "ats_field" }
    this.mapping = clientFieldMapping || {};
  }

  /**
   * Maps an ATS object to the standard Engine object
   */
  toStandard(atsObject) {
    const standardObject = {};
    for (const [engineField, atsField] of Object.entries(this.mapping)) {
      standardObject[engineField] = this._resolvePath(atsObject, atsField);
    }
    return standardObject;
  }

  /**
   * Maps a standard Engine object back to an ATS-specific object
   */
  toATS(standardObject) {
    const atsObject = {};
    for (const [engineField, atsField] of Object.entries(this.mapping)) {
      if (standardObject[engineField] !== undefined) {
        this._setPath(atsObject, atsField, standardObject[engineField]);
      }
    }
    return atsObject;
  }

  _resolvePath(obj, path) {
    return path.split('.').reduce((prev, curr) => prev ? prev[curr] : null, obj);
  }

  _setPath(obj, path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    const target = parts.reduce((prev, curr) => {
      if (!prev[curr]) prev[curr] = {};
      return prev[curr];
    }, obj);
    target[last] = value;
  }
}
