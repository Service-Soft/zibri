{{! where each of the two things a build needs goes: the routes each released version served, and,
    in translations/, the extracted translation source. Both carry a ".gitkeep", because git records
    files rather than folders - without one the first commit of a new project drops them again, and
    the clone after it has a build that fails on a folder its own config names and an application
    that refuses to start because its version history is not there }}
