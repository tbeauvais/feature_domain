
angular.module('sampleDomainApp').factory 'AppFeatures', ['Features', (Features) ->

  find: (id) ->
    this.features().filter (feature) ->
      id == feature.id

  delete: (id) ->
    index = 0
    features = this.features()
    while features[index].id != id
      index += 1

    features.splice(index, 1)


  features: ->
    this.app_features

  app_features:
    [
      {
        feature: 'HeaderFeature'
        id: '1'
        template: 'add-header'
        inputs:
          name: 'Top Header'
          text: 'Here we go...'
          size: 1
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'ContainerFeature'
        id: '10'
        template: 'add-container'
        inputs:
          name: 'My Container'
          columns: 3
          rows: 1
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'TextFeature'
        id: '2'
        template: 'add-text'
        inputs:
          name: 'Simple text'
          text: 'This is from Feature #1'
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'ImageFeature'
        id: '3'
        template: 'add-image'
        inputs:
          name: 'Capybara'
          alt: 'This is from Feature #1'
          src: 'http://a-z-animals.com/media/animals/images/original/capybara3.jpg'
          height: 150
          width: 150
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'LinkFeature'
        id: '4'
        template: 'add-link'
        inputs:
          name: 'Github link'
          text: 'GitHub'
          href: 'https://github.com'
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'TextFeature'
        id: '5'
        template: 'add-text'
        inputs:
          name: 'More text'
          text: 'This is from the second Feature'
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'ImageFeature'
        id: '6'
        template: 'add-image'
        inputs:
          name: 'Google map'
          alt: 'This is from Feature #1'
          src: 'http://maps.googleapis.com/maps/api/staticmap?center=Brooklyn+Bridge,New+York,NY&zoom=13&size=200x100&maptype=roadmap
                              &markers=color:blue%7Clabel:S%7C40.702147,-74.015794&markers=color:green%7Clabel:G%7C40.711614,-74.012318
                              &markers=color:red%7Clabel:C%7C40.718217,-73.998284'
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'ListFeature'
        id: '7'
        template: 'add-list'
        inputs:
          name: 'Color list'
          list: 'Red,Green,Blue'
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'HeaderFeature'
        id: '8'
        template: 'add-header'
        inputs:
          name: 'Small header'
          text: 'Another header'
          size: 4
          page_location:
            name: 'Page 1'
            target: '#content_section'
      },
      {
        feature: 'LinkFeature'
        id: '9'
        template: 'add-link'
        inputs:
          name: 'Google link'
          text: 'Google'
          href: 'http://www.google.com'
          page_location:
            name: 'Page 1'
            target: '#content_section'
      }

    ]

]
