import { runGet, parseID } from '../execute';
import { Node } from '../types/Node';

import { GraphQLID, GraphQLNonNull } from 'graphql';

export const getNode = schema => ({
  type: Node,
  description: `Common endpoint`,
  args: {
    id: { type: new GraphQLNonNull(GraphQLID) },
  },
  resolve: async (root, args, context, info) => {
    const { className, objectId } = parseID(args.id);
    return await runGet(context, info, className, objectId, schema);
  },
});

export default {
  Query: schema => {
    return {
      node: getNode(schema),
    };
  },
};
