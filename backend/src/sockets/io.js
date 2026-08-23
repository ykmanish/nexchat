let io = null;

export const setIO = (instance) => {
  io = instance;
};

/** Controllers reach for the live server through this instead of importing
 *  the socket module directly, which would create a require cycle. */
export const getIO = () => io;
