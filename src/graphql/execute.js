import rest from '../rest';
import { toGraphQLACL } from './types/ACL';
export { rest };

export function getGloballyUniqueId(className, objectId) {
  return base64(`${className}::${objectId}`);
}

export function transformResult(className, result) {
  if (Array.isArray(result)) {
    return result.map(res => transformResult(className, res));
  }
  if (result.objectId) {
    // Make a unique identifier for relay
    result.id = getGloballyUniqueId(className, result.objectId);
  }
  if (result.ACL) {
    result.ACL = toGraphQLACL(result.ACL);
  }
  return Object.assign({ className }, result);
}

function toGraphQLResult(className) {
  return restResult => {
    const results = restResult.results;
    if (results.length == 0) {
      return [];
    }
    return transformResult(className, results);
  };
}

export function transformQueryConstraint(key, value) {
  if (key === 'nearSphere') {
    value = {
      latitude: value.point.latitude,
      longitude: value.point.longitude,
    };
  }
  return {
    key: `$${key}`,
    value,
  };
}

function transformQuery(query) {
  Object.keys(query).forEach(queryKey => {
    Object.keys(query[queryKey]).forEach(constraintKey => {
      const constraint = query[queryKey][constraintKey];
      delete query[queryKey][constraintKey];
      const { key, value } = transformQueryConstraint(
        constraintKey,
        constraint
      );
      query[queryKey][key] = value;
    });
  });
  return query;
}

export function base64(string) {
  return new Buffer(string).toString('base64');
}

export function parseID(base64String) {
  // Get the selections
  const components = new Buffer(base64String, 'base64')
    .toString('utf8')
    .split('::');
  if (components.length != 2) {
    throw new Error('Invalid ID');
  }
  return {
    className: components[0],
    objectId: components[1],
  };
}

export function connectionResultsArray(results, args, defaultPageSize) {
  const pageSize = args.first || args.last || defaultPageSize;
  return {
    nodes: () => results,
    edges: () =>
      results.map(node => {
        return {
          cursor: base64(node.createdAt),
          node,
        };
      }),
    pageInfo: () => {
      const hasPreviousPage = () => {
        if (args.last) {
          return results.length === pageSize;
        }
        if (args.after) {
          return true;
        }
        return false;
      };
      const hasNextPage = () => {
        if (args.first) {
          return results.length === pageSize;
        }
        if (args.before) {
          return true;
        }
        return false;
      };
      return {
        hasNextPage,
        hasPreviousPage,
      };
    },
  };
}

function parseArguments(args) {
  const query = {};
  const options = {};
  if (Object.prototype.hasOwnProperty.call(args, 'first')) {
    options.limit = args.first;
    options.order = 'createdAt';
  }
  if (Object.prototype.hasOwnProperty.call(args, 'last')) {
    options.limit = args.last;
    options.order = '-createdAt';
  }
  if (Object.prototype.hasOwnProperty.call(args, 'after')) {
    query.createdAt = {
      $gt: new Date(new Buffer(args.after, 'base64').toString('utf8')),
    };
  }
  if (Object.prototype.hasOwnProperty.call(args, 'before')) {
    query.createdAt = {
      $lt: new Date(new Buffer(args.before, 'base64').toString('utf8')),
    };
  }
  if (Object.prototype.hasOwnProperty.call(args, 'redirectClassNameForKey')) {
    options.redirectClassNameForKey = args.redirectClassNameForKey;
  }
  return { options, queryAdditions: query };
}

// Runs a find against the rest API
export function runFind(context, info, className, args, schema, restQuery) {
  const query = {};
  if (args.where) {
    Object.assign(query, args.where);
  }
  transformQuery(query, schema);
  if (restQuery) {
    Object.assign(query, restQuery);
  }

  const { options, queryAdditions } = parseArguments(args);
  Object.assign(query, queryAdditions);

  return rest
    .find(context.config, context.auth, className, query, options)
    .then(toGraphQLResult(className));
}

// runs a get against the rest API
export function runGet(context, info, className, objectId) {
  return rest
    .get(context.config, context.auth, className, objectId, {})
    .then(toGraphQLResult(className))
    .then(results => results[0]);
}

export function resolvePointer(targetClass, object, schema, context, info) {
  const selections = info.fieldNodes[0].selectionSet.selections.map(field => {
    return field.name.value;
  });
  if (containsOnlyIdFields(selections)) {
    return transformResult(targetClass, object, schema, { context, info });
  }

  return runGet(context, info, object.className, object.objectId, schema);
}

export function containsOnlyIdFields(selections) {
  // id and objectId are always available
  // In this case we avoid making a fetch
  // as the caller doesn't need more info
  const wantsId = selections.indexOf('id') >= 0;
  const wantsObjectId = selections.indexOf('objectId') >= 0;
  return (
    (wantsId && wantsObjectId && selections.length == 2) ||
    (wantsId && selections.length == 1) ||
    (wantsObjectId && selections.length == 1)
  );
}

export function handleFileUpload(config, auth, className, input, schema) {
  const objectSchema = schema[className];
  const promises = Object.keys(objectSchema.fields)
    .filter(field => objectSchema.fields[field].type === 'File')
    .reduce((memo, field) => {
      if (input[field]) {
        memo.push({ fieldName: field, contents: input[field] });
      }
      return memo;
    }, [])
    .map(({ fieldName, contents: { name, base64, contentType } }) => {
      return config.filesController
        .createFile(config, name, new Buffer(base64, 'base64'), contentType)
        .then(({ url, name }) => {
          input[fieldName] = { url, name, __type: 'File' };
        });
    });
  return Promise.all(promises);
}
