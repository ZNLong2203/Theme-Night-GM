// Development-only catalog used when no QLOO_API_KEY is configured. The UI labels every result
// produced from this file as SIMULATED so it is never mistaken for Qloo data.

export interface MockItem {
  name: string;
  kind: "movie" | "tv_show" | "artist" | "videogame" | "podcast" | "book" | "brand";
  year?: number;
  /** -1 skews older audiences, +1 skews younger. */
  age: number;
  /** -1 skews male, +1 skews female. */
  gender: number;
  family?: boolean;
  /** -1 cooling, +1 rising. */
  trend: number;
  pop: number;
  owners?: string[];
  industries?: string[];
  tags: string[];
  regions?: string[];
}

const m = (
  name: string,
  year: number,
  age: number,
  gender: number,
  trend: number,
  pop: number,
  owners: string[],
  tags: string[],
  extra: Partial<MockItem> = {},
): MockItem => ({ name, kind: "movie", year, age, gender, trend, pop, owners, tags, ...extra });

export const MOCK_CATALOG: MockItem[] = [
  // Movies
  m("Top Gun: Maverick", 2022, -0.2, -0.4, -0.2, 0.99, ["Paramount Pictures"], ["Aviation", "Action", "Nostalgia"]),
  m("Barbie", 2023, 0.4, 0.8, -0.3, 0.99, ["Warner Bros."], ["Comedy", "Pink", "Fashion"]),
  m("Dune: Part Two", 2024, 0.3, -0.5, 0.1, 0.97, ["Legendary", "Warner Bros."], ["Sci-Fi", "Epic"]),
  m("Spider-Man: Across the Spider-Verse", 2023, 0.7, -0.3, 0.2, 0.97, ["Sony Pictures"], ["Animation", "Superhero"], { family: true }),
  m("Inside Out 2", 2024, 0.2, 0.3, 0.0, 0.98, ["Disney", "Pixar"], ["Animation", "Feelings"], { family: true }),
  m("Wicked", 2024, 0.5, 0.8, 0.3, 0.97, ["Universal Pictures"], ["Musical", "Fantasy"]),
  m("Twisters", 2024, -0.1, -0.2, -0.1, 0.92, ["Universal Pictures"], ["Storm Chasing", "Action"], { regions: ["OK", "TX", "KS"] }),
  m("Everything Everywhere All at Once", 2022, 0.5, 0.1, -0.2, 0.9, ["A24"], ["Multiverse", "Indie"]),
  m("Bull Durham", 1988, -0.8, -0.3, 0.1, 0.72, ["Orion Pictures"], ["Baseball", "Romance", "Minor League"], { regions: ["NC", "Durham"] }),
  m("The Sandlot", 1993, -0.4, -0.3, 0.2, 0.86, ["20th Century Fox"], ["Baseball", "Childhood", "Summer"], { family: true }),
  m("Field of Dreams", 1989, -0.8, -0.5, 0.0, 0.8, ["Universal Pictures"], ["Baseball", "Iowa", "Nostalgia"], { regions: ["IA"] }),
  m("Moana 2", 2024, 0.6, 0.4, 0.1, 0.95, ["Disney"], ["Animation", "Ocean"], { family: true }),
  m("Deadpool & Wolverine", 2024, 0.3, -0.6, -0.2, 0.97, ["Marvel Studios", "Disney"], ["Superhero", "Comedy"]),
  m("Sinners", 2025, 0.2, 0.0, 0.6, 0.9, ["Warner Bros."], ["Blues", "Horror", "Southern Gothic"], { regions: ["MS", "South"] }),
  m("A Minecraft Movie", 2025, 0.9, -0.3, 0.3, 0.93, ["Warner Bros.", "Legendary"], ["Video Game Adaptation", "Comedy"], { family: true }),
  m("KPop Demon Hunters", 2025, 0.9, 0.6, 0.95, 0.94, ["Sony Pictures Animation", "Netflix"], ["K-Pop", "Animation", "Music"], { family: true }),
  m("F1", 2025, -0.2, -0.6, 0.4, 0.9, ["Apple Original Films"], ["Racing", "Sports"]),
  m("Lilo & Stitch", 2025, 0.6, 0.4, 0.2, 0.95, ["Disney"], ["Hawaii", "Family"], { family: true }),
  m("How to Train Your Dragon", 2025, 0.6, 0.0, 0.3, 0.92, ["Universal Pictures", "DreamWorks"], ["Dragons", "Fantasy"], { family: true }),
  m("Superman", 2025, 0.1, -0.4, 0.3, 0.93, ["DC Studios", "Warner Bros."], ["Superhero"]),
  m("The Big Lebowski", 1998, -0.4, -0.7, 0.1, 0.85, ["Gramercy Pictures"], ["Bowling", "Cult Classic"], { regions: ["CA", "Los Angeles"] }),
  m("La La Land", 2016, 0.0, 0.6, -0.1, 0.9, ["Lionsgate"], ["Jazz", "Musical", "Los Angeles"], { regions: ["Los Angeles", "CA"] }),
  // TV
  ...(
    [
      ["Stranger Things", 2016, 0.6, 0.0, 0.5, 0.99, ["Netflix"], ["80s", "Sci-Fi", "Small Town"]],
      ["Bluey", 2018, 0.3, 0.4, 0.4, 0.95, ["Ludo Studio", "BBC Studios"], ["Preschool", "Family", "Dogs"], { family: true }],
      ["The Bear", 2022, 0.2, 0.1, -0.1, 0.9, ["FX"], ["Restaurant", "Chicago"], { regions: ["IL", "Chicago"] }],
      ["Ted Lasso", 2020, -0.1, 0.1, -0.3, 0.92, ["Apple TV+"], ["Soccer", "Feel-Good"]],
      ["Yellowstone", 2018, -0.7, -0.2, -0.1, 0.96, ["Paramount Network"], ["Western", "Ranch"], { regions: ["MT", "TX", "South"] }],
      ["Squid Game", 2021, 0.6, -0.1, 0.0, 0.96, ["Netflix"], ["Korean", "Thriller"]],
      ["Wednesday", 2022, 0.8, 0.6, 0.2, 0.95, ["Netflix", "MGM Television"], ["Goth", "Mystery"]],
      ["The Last of Us", 2023, 0.3, -0.3, 0.0, 0.94, ["HBO"], ["Post-Apocalyptic", "Video Game Adaptation"]],
      ["Abbott Elementary", 2021, 0.1, 0.5, 0.1, 0.88, ["ABC"], ["Mockumentary", "Teachers", "Philadelphia"]],
      ["Severance", 2022, 0.2, 0.0, 0.3, 0.88, ["Apple TV+"], ["Office", "Sci-Fi"]],
      ["The Office", 2005, 0.4, 0.2, 0.0, 0.99, ["NBC", "Universal Television"], ["Office", "Comedy"]],
      ["Love Island USA", 2019, 0.9, 0.9, 0.7, 0.9, ["Peacock"], ["Reality", "Dating"]],
      ["The Pitt", 2025, 0.0, 0.4, 0.7, 0.86, ["HBO Max"], ["Medical", "Pittsburgh"], { regions: ["PA", "Pittsburgh"] }],
      ["Outer Banks", 2020, 0.9, 0.7, 0.1, 0.9, ["Netflix"], ["Treasure Hunt", "Beach", "North Carolina"], { regions: ["NC"] }],
      ["Avatar: The Last Airbender", 2005, 0.6, -0.1, 0.1, 0.9, ["Nickelodeon"], ["Animation", "Fantasy"], { family: true }],
      ["Grey's Anatomy", 2005, -0.1, 0.9, -0.3, 0.95, ["ABC"], ["Medical", "Drama"]],
      ["Portlandia", 2011, 0.0, 0.1, -0.2, 0.7, ["IFC"], ["Sketch Comedy", "Portland"], { regions: ["OR", "Portland"] }],
      ["Nashville", 2012, -0.3, 0.8, -0.4, 0.75, ["ABC", "CMT"], ["Country Music"], { regions: ["TN", "Nashville"] }],
    ] as [string, number, number, number, number, number, string[], string[], Partial<MockItem>?][]
  ).map(([name, year, age, gender, trend, pop, owners, tags, extra]) => ({
    ...m(name, year, age, gender, trend, pop, owners, tags, extra),
    kind: "tv_show" as const,
  })),
  // Artists
  ...(
    [
      ["Taylor Swift", 0.6, 0.8, 0.0, 0.99, ["Pop", "Singer-Songwriter"]],
      ["Zach Bryan", 0.3, -0.4, 0.2, 0.93, ["Country", "Americana"], { regions: ["South", "OK"] }],
      ["Bad Bunny", 0.7, 0.0, 0.2, 0.98, ["Reggaeton", "Latin Trap"], { regions: ["Los Angeles", "FL", "TX"] }],
      ["Morgan Wallen", 0.2, -0.2, 0.0, 0.97, ["Country"], { regions: ["TN", "South", "Nashville"] }],
      ["Sabrina Carpenter", 0.9, 0.8, 0.5, 0.95, ["Pop"]],
      ["Chappell Roan", 0.8, 0.7, 0.6, 0.9, ["Pop", "Camp"]],
      ["Kendrick Lamar", 0.5, -0.4, 0.2, 0.97, ["Hip-Hop", "West Coast"], { regions: ["Los Angeles", "CA"] }],
      ["Noah Kahan", 0.6, 0.4, 0.2, 0.88, ["Folk Pop", "New England"]],
      ["Luke Combs", -0.1, -0.2, -0.1, 0.92, ["Country"], { regions: ["NC", "South"] }],
      ["J. Cole", 0.5, -0.4, 0.0, 0.93, ["Hip-Hop"], { regions: ["NC", "Durham"] }],
      ["Sylvan Esso", 0.2, 0.3, 0.2, 0.62, ["Electropop", "Indie"], { regions: ["NC", "Durham"] }],
      ["The Avett Brothers", -0.3, -0.1, -0.1, 0.75, ["Folk Rock", "Americana"], { regions: ["NC", "South"] }],
      ["Tyler Childers", 0.1, -0.3, 0.3, 0.84, ["Country", "Bluegrass"], { regions: ["KY", "South"] }],
      ["Billy Strings", 0.0, -0.4, 0.5, 0.8, ["Bluegrass", "Jam"], { regions: ["NC", "TN", "South"] }],
      ["Dolly Parton", -0.6, 0.5, 0.1, 0.96, ["Country", "Icon"], { regions: ["TN", "Nashville", "South"] }],
      ["Jimmy Buffett", -0.9, -0.2, -0.3, 0.88, ["Tropical Rock", "Parrotheads"], { regions: ["FL"] }],
      ["Grateful Dead", -0.8, -0.5, 0.0, 0.9, ["Jam", "Classic Rock"], { regions: ["CA", "Portland", "OR"] }],
      ["Olivia Rodrigo", 0.95, 0.8, 0.1, 0.95, ["Pop Rock"]],
      ["Peso Pluma", 0.8, -0.1, 0.0, 0.88, ["Corridos Tumbados"], { regions: ["Los Angeles", "TX", "CA"] }],
      ["Karol G", 0.7, 0.6, 0.2, 0.92, ["Reggaeton"], { regions: ["Los Angeles", "FL"] }],
      ["Lainey Wilson", 0.1, 0.4, 0.4, 0.84, ["Country"], { regions: ["TN", "Nashville", "South"] }],
      ["Doechii", 0.8, 0.4, 0.8, 0.84, ["Hip-Hop"], { regions: ["FL"] }],
      ["Phish", -0.5, -0.6, 0.0, 0.8, ["Jam"], { regions: ["VT", "Portland"] }],
      ["Portugal. The Man", 0.1, 0.0, -0.2, 0.7, ["Indie Rock"], { regions: ["Portland", "OR"] }],
      ["HUNTR/X", 0.95, 0.6, 0.95, 0.85, ["K-Pop", "Soundtrack"], { family: true }],
    ] as [string, number, number, number, number, string[], Partial<MockItem>?][]
  ).map(([name, age, gender, trend, pop, tags, extra]) => ({
    name,
    kind: "artist" as const,
    age,
    gender,
    trend,
    pop,
    tags,
    ...extra,
  })),
  // Video games
  ...(
    [
      ["Minecraft", 0.95, -0.4, 0.1, 0.99, ["Mojang", "Microsoft"], ["Sandbox", "Building"], { family: true }],
      ["Fortnite", 0.95, -0.6, 0.0, 0.99, ["Epic Games"], ["Battle Royale"]],
      ["Pokémon Scarlet and Violet", 0.8, -0.1, -0.1, 0.94, ["Nintendo", "The Pokémon Company"], ["Monster Collecting"], { family: true }],
      ["Mario Kart 8 Deluxe", 0.7, -0.1, 0.0, 0.97, ["Nintendo"], ["Racing", "Party"], { family: true }],
      ["Animal Crossing: New Horizons", 0.6, 0.7, -0.3, 0.92, ["Nintendo"], ["Cozy", "Life Sim"], { family: true }],
      ["Roblox", 1.0, -0.2, 0.1, 0.98, ["Roblox Corporation"], ["Platform", "UGC"], { family: true }],
      ["Elden Ring", 0.4, -0.8, -0.1, 0.9, ["FromSoftware", "Bandai Namco"], ["Soulslike"]],
      ["Stardew Valley", 0.5, 0.4, 0.3, 0.88, ["ConcernedApe"], ["Farming", "Cozy"]],
      ["Hollow Knight: Silksong", 0.6, -0.5, 0.9, 0.84, ["Team Cherry"], ["Metroidvania", "Indie"]],
      ["Baldur's Gate 3", 0.4, -0.4, 0.0, 0.88, ["Larian Studios"], ["RPG", "Fantasy"]],
      ["Rocket League", 0.8, -0.8, -0.1, 0.86, ["Psyonix", "Epic Games"], ["Car Soccer", "Esports"]],
      ["MLB The Show 25", 0.4, -0.9, 0.1, 0.8, ["Sony Interactive Entertainment"], ["Baseball", "Sports Sim"]],
      ["Super Mario Bros. Wonder", 0.7, -0.1, 0.0, 0.9, ["Nintendo"], ["Platformer"], { family: true }],
    ] as [string, number, number, number, number, string[], string[], Partial<MockItem>?][]
  ).map(([name, age, gender, trend, pop, owners, tags, extra]) => ({
    name,
    kind: "videogame" as const,
    age,
    gender,
    trend,
    pop,
    owners,
    tags,
    ...extra,
  })),
  // Podcasts
  ...(
    [
      ["SmartLess", -0.2, 0.2, -0.2, 0.92, ["Comedy", "Interview"]],
      ["Call Her Daddy", 0.8, 0.95, 0.0, 0.94, ["Relationships", "Comedy"]],
      ["New Heights", 0.4, 0.3, 0.4, 0.93, ["Football", "Sports Comedy"]],
      ["Crime Junkie", 0.4, 0.9, -0.1, 0.94, ["True Crime"]],
      ["Pardon My Take", 0.5, -0.9, -0.2, 0.88, ["Sports", "Comedy"]],
      ["Armchair Expert", 0.1, 0.4, -0.1, 0.9, ["Interview"]],
      ["Office Ladies", 0.3, 0.8, -0.2, 0.84, ["TV Rewatch", "Comedy"]],
      ["The Rewatchables", -0.1, -0.6, 0.0, 0.82, ["Movies", "Comedy"]],
      ["Morbid", 0.5, 0.9, 0.1, 0.85, ["True Crime", "Comedy"]],
      ["Las Culturistas", 0.6, 0.5, 0.5, 0.8, ["Pop Culture", "Comedy"]],
    ] as [string, number, number, number, number, string[]][]
  ).map(([name, age, gender, trend, pop, tags]) => ({ name, kind: "podcast" as const, age, gender, trend, pop, tags })),
  // Books
  ...(
    [
      ["Fourth Wing", 0.7, 0.9, 0.3, 0.92, ["Romantasy", "Dragons"]],
      ["Harry Potter and the Sorcerer's Stone", 0.5, 0.3, 0.0, 0.99, ["Fantasy", "Wizards"], { family: true }],
      ["Percy Jackson and the Lightning Thief", 0.8, 0.0, 0.1, 0.93, ["Mythology", "Middle Grade"], { family: true }],
      ["Project Hail Mary", 0.1, -0.4, 0.4, 0.88, ["Sci-Fi", "Space"]],
      ["Where the Crawdads Sing", -0.3, 0.8, -0.3, 0.9, ["Mystery", "North Carolina", "Marsh"], { regions: ["NC"] }],
      ["Dog Man", 0.9, -0.2, 0.0, 0.92, ["Graphic Novel", "Kids"], { family: true }],
      ["Lessons in Chemistry", -0.2, 0.8, -0.3, 0.86, ["Historical Fiction"]],
    ] as [string, number, number, number, number, string[], Partial<MockItem>?][]
  ).map(([name, age, gender, trend, pop, tags, extra]) => ({ name, kind: "book" as const, age, gender, trend, pop, tags, ...extra })),
  // Brands
  ...(
    [
      ["Liquid Death", 0.8, -0.3, 0.4, 0.86, ["Beverages", "Water"], ["Irreverent", "Sustainable"]],
      ["Celsius", 0.8, 0.2, 0.3, 0.88, ["Beverages", "Energy Drinks"], ["Fitness"]],
      ["Modelo", 0.2, -0.6, 0.2, 0.93, ["Beer", "Alcoholic Beverages"], ["Mexican Lager"]],
      ["Michelob Ultra", -0.1, -0.2, 0.1, 0.92, ["Beer", "Alcoholic Beverages"], ["Active Lifestyle"]],
      ["White Claw", 0.5, 0.4, -0.3, 0.9, ["Hard Seltzer", "Alcoholic Beverages"], ["Summer"]],
      ["Cheerwine", -0.3, 0.0, 0.2, 0.62, ["Beverages", "Soft Drinks"], ["Southern", "Cherry Soda"], { regions: ["NC", "South"] }],
      ["Krispy Kreme", 0.2, 0.2, 0.0, 0.9, ["Food", "Bakery", "Restaurants"], ["Donuts"], { regions: ["NC", "South"] }],
      ["Bojangles", -0.1, -0.1, 0.0, 0.8, ["Quick Service Restaurants", "Restaurants"], ["Fried Chicken", "Biscuits"], { regions: ["NC", "South"] }],
      ["Chick-fil-A", 0.3, 0.3, 0.1, 0.97, ["Quick Service Restaurants", "Restaurants"], ["Chicken"], { family: true }],
      ["Taco Bell", 0.8, -0.3, 0.1, 0.95, ["Quick Service Restaurants", "Restaurants"], ["Late Night"]],
      ["In-N-Out Burger", 0.5, -0.2, 0.0, 0.93, ["Quick Service Restaurants", "Restaurants"], ["Burgers", "California"], { regions: ["CA", "Los Angeles"] }],
      ["Duke's Mayonnaise", -0.4, 0.2, 0.3, 0.7, ["Food", "Condiments"], ["Southern"], { regions: ["NC", "SC", "South"] }],
      ["Lowe's", -0.4, -0.3, -0.1, 0.94, ["Home Improvement", "Retail"], ["DIY"], { regions: ["NC"] }],
      ["YETI", -0.1, -0.5, 0.0, 0.9, ["Outdoor Gear", "Drinkware"], ["Outdoors"]],
      ["Stanley", 0.4, 0.8, -0.4, 0.9, ["Drinkware"], ["Tumblers"]],
      ["Patagonia", 0.1, 0.0, 0.0, 0.93, ["Apparel", "Outdoor Gear"], ["Sustainable"], { regions: ["CA", "Portland", "OR"] }],
      ["Nike", 0.6, -0.1, 0.0, 0.99, ["Apparel", "Footwear"], ["Athletic"], { regions: ["Portland", "OR"] }],
      ["Crocs", 0.8, 0.3, 0.2, 0.9, ["Footwear"], ["Comfort", "Collabs"], { family: true }],
      ["T-Mobile", 0.4, 0.0, 0.0, 0.95, ["Telecommunications"], ["Wireless"]],
      ["Verizon", -0.1, 0.0, -0.1, 0.96, ["Telecommunications"], ["Wireless"]],
      ["Toyota", -0.1, -0.1, 0.0, 0.97, ["Automotive"], ["Reliability"]],
      ["Ford", -0.4, -0.5, -0.1, 0.96, ["Automotive"], ["Trucks"], { regions: ["South", "TX"] }],
      ["Subaru", -0.1, 0.1, 0.0, 0.9, ["Automotive"], ["Outdoors"], { regions: ["Portland", "OR", "CO"] }],
      ["State Farm", -0.3, 0.0, -0.1, 0.94, ["Insurance", "Financial Services"], ["Good Neighbor"]],
      ["Geico", 0.0, -0.1, -0.1, 0.94, ["Insurance", "Financial Services"], ["Gecko"]],
      ["LEGO", 0.5, -0.3, 0.1, 0.97, ["Toys"], ["Building"], { family: true }],
      ["Build-A-Bear Workshop", 0.7, 0.6, 0.1, 0.84, ["Toys", "Retail"], ["Plush"], { family: true }],
      ["Hershey's", 0.3, 0.2, -0.1, 0.95, ["Food", "Confectionery"], ["Chocolate"], { family: true }],
      ["Ben & Jerry's", 0.3, 0.4, -0.1, 0.92, ["Food", "Ice Cream"], ["Activism"], { regions: ["VT"] }],
      ["Voodoo Doughnut", 0.4, 0.2, -0.1, 0.72, ["Food", "Bakery"], ["Weird"], { regions: ["Portland", "OR"] }],
      ["Duolingo", 0.8, 0.3, 0.3, 0.88, ["Education", "Technology"], ["Owl", "Memes"]],
      ["Nintendo", 0.7, -0.2, 0.1, 0.97, ["Video Games", "Entertainment"], ["Gaming"], { family: true }],
      ["Spotify", 0.8, 0.2, 0.0, 0.98, ["Music Streaming", "Technology"], ["Playlists"]],
      ["Dodger Dogs", -0.1, -0.3, 0.0, 0.6, ["Food", "Concessions"], ["Ballpark"], { regions: ["Los Angeles"] }],
    ] as [string, number, number, number, number, string[], string[], Partial<MockItem>?][]
  ).map(([name, age, gender, trend, pop, industries, tags, extra]) => ({
    name,
    kind: "brand" as const,
    age,
    gender,
    trend,
    pop,
    industries,
    tags,
    ...extra,
  })),
];

/** Words used to fabricate believable venue-adjacent places in simulated mode. */
export const MOCK_PLACE_PARTS = {
  prefixes: ["Copper", "Bull City", "Old Mill", "Union", "Lantern", "Third Base", "Iron", "Magnolia", "Rail Yard", "Night Owl", "Riverside", "Golden Hour"],
  types: [
    { noun: "Taproom", tag: "Brewery" },
    { noun: "Biscuit Co.", tag: "Breakfast" },
    { noun: "Arcade Bar", tag: "Arcade" },
    { noun: "Records", tag: "Record Store" },
    { noun: "Comics & Games", tag: "Game Store" },
    { noun: "Taqueria", tag: "Mexican Restaurant" },
    { noun: "BBQ", tag: "Barbecue" },
    { noun: "Ice Cream Parlor", tag: "Dessert" },
    { noun: "Music Hall", tag: "Live Music Venue" },
    { noun: "Coffee Roasters", tag: "Coffee Shop" },
    { noun: "Board Game Cafe", tag: "Board Games" },
    { noun: "Bookshop", tag: "Bookstore" },
  ],
};

/** Region hints so simulated local affinity behaves plausibly for the demo cities. */
export const CITY_REGIONS: { match: RegExp; regions: string[] }[] = [
  { match: /durham|raleigh|chapel hill|charlotte|greensboro|north carolina|\bnc\b/i, regions: ["NC", "Durham", "South"] },
  { match: /los angeles|\bla\b|hollywood|anaheim|california|\bca\b/i, regions: ["Los Angeles", "CA"] },
  { match: /portland|oregon|\bor\b/i, regions: ["Portland", "OR"] },
  { match: /nashville|tennessee|\btn\b/i, regions: ["Nashville", "TN", "South"] },
  { match: /chicago|illinois/i, regions: ["Chicago", "IL"] },
  { match: /pittsburgh/i, regions: ["Pittsburgh", "PA"] },
];
