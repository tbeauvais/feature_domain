(function(){

  describe('factory: Features', function () {
    var features;

    beforeEach(module('sampleDomainApp'));

    beforeEach(function() {

      inject(function ($injector) {
        features = $injector.get('Features');
      });

    });

    it('getFeature returns the correct feature', function () {
      expect(features.getFeature('TextFeature').name).toEqual('Text');
    });

    it('createFeatureInstance returns feature instance object', function () {
     var featureInstance = {
        feature: 'TextFeature',
        id: '9',
        template: '',
        inputs: {
          name: '',
          text: '',
          page_location: {
            name: 'Page 1',
            target: '#content_section'
          }
        }
      };
      expect(features.createFeatureInstance('TextFeature')).toEqual(featureInstance);
    });

    it('getFeatures returns all features', function () {
      expect(features.getFeatures()).not.toEqual(null);
    });

  });


  describe('factory: AppFeatures', function () {
    var appFeatures;

    beforeEach(module('sampleDomainApp'));

    beforeEach(function() {
      inject(function ($injector) {
        appFeatures = $injector.get('AppFeatures');

        var app_features = [{id: '1'}, {id: '2'}];

        appFeatures.features = function() {
          return app_features
        }

      });
    });

    it('find returns the correct feature instance', function () {
      expect(appFeatures.find('1').id).toEqual('1');
    });

    it('add inserts a new feature instance', function () {
      appFeatures.add({id: ''});
      expect(appFeatures.features().length).toEqual(3);
    });

    it('add returns the inserted feature instance', function () {
      expect(appFeatures.add({id: ''})).toEqual({id: '3'});
    });

    it('delete removes the specified feature instance', function () {
      appFeatures.delete('2');
      expect(appFeatures.features().length).toEqual(1);
      expect(appFeatures.find('2')).toEqual(undefined);
    });

    it('nextIndex gets the next highest index', function () {
      expect(appFeatures.nextIndex()).toEqual('3');
    });


  });


  describe('factory: AppMetadata', function () {
    var appMetadata;

    beforeEach(module('sampleDomainApp'));

    beforeEach(function() {
      inject(function ($injector) {
        appMetadata = $injector.get('AppMetadata');

      });
    });

    it('reset sets root to null', function () {
      expect(appMetadata.reset()).toEqual(null);
    });

    it('getPageTargets gets the targets for the specified page', function () {
      var nodes = appMetadata.getPageTargets('Page 1');
      var targets = _.map(nodes, function(target){
        return target.model.name;
      });
      expect(targets).toEqual(['#content_section']);
    });

    it('getPages gets all the pages', function () {
      expect(appMetadata.getPages()).toEqual(['Page 1']);
    });

    it('addPageTarget adds the targets to the specified page', function () {
      appMetadata.addPageTarget('Page 1', '#new_target');
      var nodes = appMetadata.getPageTargets('Page 1');
      var targets = _.map(nodes, function(target){
        return target.model.name;
      });

      expect(targets).toEqual(['#content_section','#new_target']);
    });


  });


})();
