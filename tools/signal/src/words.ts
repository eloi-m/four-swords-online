// Room codes: common 4- and 5-letter English nouns, easy to spell and to say over a call (no homophones of other
// common words, no spelling variants, no proper names, nothing rude in any slang). Open rooms can't outnumber them.
export const ROOM_WORDS: readonly string[] = [
  // animals
  "BEAR", "WOLF", "LION", "TIGER", "ZEBRA", "HORSE", "MOUSE", "CAMEL", "SHEEP", "GOAT", "DUCK", "SWAN", "CRANE",
  "EAGLE", "HAWK", "CROW", "DOVE", "ROBIN", "FINCH", "STORK", "HERON", "GOOSE", "PANDA", "KOALA", "OTTER", "SEAL",
  "SHARK", "SQUID", "CRAB", "CLAM", "SNAIL", "FROG", "TOAD", "NEWT", "SNAKE", "MOTH", "WASP", "TROUT", "TUNA", "PONY",
  "MULE", "BISON", "MOOSE", "HIPPO", "RHINO", "SLOTH", "LEMUR", "PUPPY", "CALF", "LAMB", "FOAL", "RAVEN",
  "GECKO", "PRAWN", "WORM", "ORCA", "DINGO", "QUAIL", "EGRET", "LARK", "GULL", "CARP", "PERCH", "COBRA", "VIPER",
  "PUMA", "BIRD", "FISH", "KIWI", "FAWN", "HOUND", "MOLE", "MINK", "CORGI", "STEED",
  // land, water and sky
  "RIVER", "LAKE", "POND", "BROOK", "OCEAN", "SHORE", "COAST", "CLIFF", "HILL", "RIDGE", "STONE", "ROCK", "SAND",
  "DUNE", "FIELD", "WOODS", "GROVE", "TREE", "LEAF", "TWIG", "SEED", "BLOOM", "DAISY", "TULIP", "LILY", "FERN",
  "MOSS", "GRASS", "CLOUD", "SNOW", "STORM", "WIND", "FROST", "STAR", "MOON", "COMET", "ORBIT", "EARTH", "DAWN",
  "DUSK", "NOON", "FLAME", "FIRE", "SPARK", "EMBER", "SMOKE", "LAVA", "MAGMA", "REEF", "CAVE", "DELTA", "MARSH",
  "SWAMP", "OASIS", "PEARL", "SHELL", "ACORN", "PINE", "MAPLE", "CEDAR", "BIRCH", "ASPEN", "PALM", "VINE", "BUSH",
  "HEDGE", "THORN", "GLADE", "SLOPE", "SPRAY", "FLOOD", "GUST", "SHADE", "LIGHT", "MOUND", "STUMP",
  "TRUNK", "BARK", "LOTUS", "POPPY", "LILAC", "SLEET", "HEAT", "GALE", "SPACE", "BEAM",
  // fruit, vegetables and food
  "PLUM", "PEACH", "APPLE", "GRAPE", "LEMON", "LIME", "MANGO", "OLIVE", "BEAN", "CORN", "WHEAT", "OATS", "RICE",
  "ONION", "BASIL", "MINT", "SAGE", "KALE", "TOAST", "HONEY", "SUGAR", "SALT", "CREAM", "PIZZA", "PASTA", "SALAD",
  "SOUP", "STEW", "CAKE", "CANDY", "FUDGE", "BAGEL", "CURRY", "TACO", "SUSHI", "GRAVY", "SAUCE", "SYRUP", "JUICE",
  "MILK", "WATER", "BACON", "SPICE", "CRUMB", "WAFER", "BROTH", "SALSA", "TOFU", "JELLY", "PUNCH", "SCONE", "ICING",
  "GRAIN", "PRUNE", "CLOVE", "CHIVE", "MOCHA", "LATTE", "SODA", "TREAT", "FEAST", "LUNCH", "SNACK", "MEAL",
  // home, tools and clothes
  "TORCH", "LAMP", "CHAIR", "TABLE", "DESK", "BENCH", "SOFA", "QUILT", "SHELF", "CLOCK", "WATCH", "BELL", "BOOK",
  "PAGE", "PAPER", "CHALK", "PAINT", "BRUSH", "EASEL", "GLOBE", "ATLAS", "CHART", "STAMP", "CARD", "KITE", "DOLL",
  "ROBOT", "DICE", "CHESS", "BLOCK", "BRICK", "TILE", "ROOF", "DOOR", "GATE", "WALL", "FENCE", "PORCH", "ATTIC",
  "CABIN", "HOUSE", "HOME", "BARN", "SHED", "TENT", "TOWER", "CITY", "TOWN", "FARM", "MILL", "DOCK", "PATH", "TRAIL",
  "LANE", "PLAZA", "PARK", "YARD", "POOL", "NAIL", "DRILL", "RULER", "ROPE", "CHAIN", "HOOK", "LOCK", "RAKE", "BROOM",
  "SOAP", "TOWEL", "COMB", "SCALE", "LENS", "PRISM", "WHEEL", "GEAR", "LEVER", "ANVIL", "FORGE", "TONGS", "GLOVE",
  "SCARF", "BOOT", "SHOE", "SOCK", "CROWN", "CAPE", "CLOAK", "COAT", "VEST", "SHIRT", "DRESS", "SKIRT", "APRON",
  "BELT", "RING", "JEWEL", "RUBY", "OPAL", "JADE", "AMBER", "TOPAZ", "GOLD", "IRON", "BRASS", "COIN", "PURSE",
  "CRATE", "CHEST", "BOWL", "PLATE", "DISH", "SPOON", "FORK", "OVEN", "STOVE", "SINK", "BATH", "LADLE", "WHISK",
  "GRILL", "TRAY", "LATCH", "HINGE", "BOLT", "CLAMP", "AXLE", "SPOKE", "SIREN", "ALARM", "CREST", "SLATE", "CRAFT",
  "BEAD", "TIARA", "FLASK", "VASE", "BASIN", "COUCH", "CRIB", "PHONE", "DRONE", "HOOD", "SHAWL", "GOWN",
  "ROBE", "TUNIC", "CLOG", "MITT", "CUFF", "PATCH", "POUCH", "WOOL", "SILK", "LACE", "LINEN", "DENIM", "CLAY",
  "GLASS", "IVORY",
  // places and getting around
  "TRAIN", "TRUCK", "BIKE", "CART", "SLED", "SKATE", "BOAT", "SHIP", "RAFT", "CANOE", "KAYAK", "BARGE", "TAXI",
  "TRAM", "MAST", "HELM", "MOTOR", "BUGGY", "COACH", "BLIMP", "STORE", "SHOP", "BANK", "HOTEL", "VILLA", "MOAT",
  "SPIRE", "DOME", "ARCH", "PORT", "CLASS", "OPERA", "COURT", "TRACK", "RINK", "SLIDE",
  // music, games and stories
  "DRUM", "HARP", "HORN", "FLUTE", "PIANO", "BANJO", "CELLO", "TUBA", "BUGLE", "RADIO", "MUSIC", "SONG", "DANCE",
  "DREAM", "SMILE", "LAUGH", "PARTY", "GAME", "MATCH", "GOAL", "SCORE", "PRIZE", "BADGE", "FLAG", "SHAPE", "CUBE",
  "CONE", "OVAL", "HEART", "POEM", "JOKE", "IDEA", "WORD", "VOICE", "ECHO", "SOUND", "TUNE", "PIXEL", "LASER",
  "RADAR", "SONAR", "STEAM", "FOAM", "TOKEN", "CHIP", "WIRE", "CABLE", "PLUG", "BULB", "TAPE", "GLUE", "CLIP", "NOTE",
  "LIST", "LABEL", "SHEET", "FRAME", "PHOTO", "VIDEO", "MOVIE", "GOLF", "POLO", "RUGBY", "VIOLA", "KAZOO", "GONG",
  "CHIME", "CHANT", "DISCO", "TANGO", "BINGO", "DART", "RELAY", "QUIZ", "CLUE", "HOPE", "TRUTH", "WISH",
  "LUCK", "FAME", "GLORY", "CHEER", "POWER", "FORCE", "SKILL", "PLAY", "SPORT", "TEAM", "CREW", "CLUB",
  "PACK", "FLOCK", "SWARM", "VOID", "PULSE", "VOLT", "FUSE",
  // quests
  "SWORD", "ARROW", "SPEAR", "FAIRY", "MAGIC", "SPELL", "WAND", "STAFF", "RUNE", "QUEST", "KING", "QUEEN", "GIANT",
  "HERO", "GUARD", "SCOUT", "PILOT", "CHEF", "BAKER", "CLOWN", "MAGE", "ARENA", "STAGE", "FORT", "CAMP", "LODGE",
  "VAULT", "HAVEN", "RELIC", "CHARM",
];
